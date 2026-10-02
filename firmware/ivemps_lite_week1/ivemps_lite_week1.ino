/*
  IVEMPS-Lite — Week 1 Firmware
  ESP32 + MQ135 (CO2 proxy) + MQ7 (CO) + MQ2 (Smoke/HC proxy) + OLED
  Goal this week: read sensors, smooth with EWMA, display on OLED.
  WiFi upload + fuzzy logic come in Week 2.

  Board: ESP32 DevKit V1
  Libraries needed (Library Manager):
    - Adafruit SSD1306
    - Adafruit GFX
*/

#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <WiFi.h>
#include <HTTPClient.h>

// Must be defined here, near the top, before any function that uses it —
// Arduino auto-generates function "previews" right after the includes, and
// if this struct were defined further down (where it's logically grouped
// with the fuzzy logic code), those auto-generated previews would reference
// a type that doesn't exist yet, causing a compile error.
struct FuzzyDegrees { float low, medium, high; };

// ---------- WIFI + BACKEND CONFIG ----------
const char* WIFI_SSID = "vivo 1723";      // fill in before testing
const char* WIFI_PASSWORD = "vijay 7890";
const char* BACKEND_URL = "https://ivemps-lite-backend.onrender.com/readings";

unsigned long lastUpload = 0;
const unsigned long UPLOAD_INTERVAL = 5000; // send to cloud every 5 sec (doesn't have to match the 3 sec sensor read)

// ---------- OLED CONFIG ----------
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

// ---------- SENSOR PINS (ADC1 channels only, WiFi-safe) ----------
const int PIN_MQ135 = 34;  // CO2 / air quality proxy
const int PIN_MQ7   = 35;  // CO
const int PIN_MQ2   = 32;  // Smoke / LPG / HC proxy

// ---------- CIRCUIT CONSTANTS ----------
const float VCC = 3.3;       // ESP32 ADC reference
const float RL_MQ135 = 20.0; // kOhm, check your specific module's load resistor
const float RL_MQ7   = 10.0;
const float RL_MQ2   = 5.0;

// ---------- CALIBRATION CONSTANTS ----------
// TODO: Fill these in after Day 4-5 calibration in clean air.
// Ro = Rs measured in clean air / (Rs/Ro ratio in clean air from datasheet)
float Ro_MQ135 = 889.40;  // calibrated 23 Sept, avg of 3 consistent runs
float Ro_MQ7   = 1.33;    // calibrated 23 Sept, avg of 3 consistent runs
float Ro_MQ2   = 0.62;    // calibrated 23 Sept, avg of 3 consistent runs

// Datasheet curve constants for ppm = a * (Rs/Ro)^b  (log-log linear approx)
// These are typical published values — refine after your own calibration if needed.
const float MQ135_A = 116.6020682, MQ135_B = -2.769034857; // CO2-ish curve (approx)
const float MQ7_A   = 99.042,      MQ7_B   = -1.518;       // CO curve (approx)
const float MQ2_A   = 574.25,      MQ2_B   = -2.222;       // Smoke/LPG curve (approx)

// ---------- EWMA SMOOTHING ----------
const float ALPHA = 0.2; // same alpha as IVEMPS base paper
float ewma_CO2 = -1, ewma_CO = -1, ewma_Smoke = -1;

// ---------- TIMING ----------
unsigned long lastRead = 0;
const unsigned long READ_INTERVAL = 3000; // 3 seconds, matches base paper sampling

float readRs(int pin, float RL) {
  int adc = analogRead(pin);              // 0-4095 on ESP32
  float vout = (adc / 4095.0) * VCC;
  if (vout < 0.01) vout = 0.01;           // avoid divide-by-zero
  float rs = ((VCC - vout) / vout) * RL;
  return rs;
}

float rsToPpm(float rs, float ro, float a, float b) {
  float ratio = rs / ro;
  if (ratio <= 0) ratio = 0.01;
  return a * pow(ratio, b);
}

// ---------- FUZZY LOGIC ----------
// Standard trapezoidal membership function: returns a value 0.0-1.0 representing
// "how much" x belongs to a fuzzy set shaped like a trapezoid with corners a,b,c,d.
//      1 |      ____
//        |     /    \
//      0 |____/      \____
//         a   b      c   d
float trapezoid(float x, float a, float b, float c, float d) {
  if (x <= a || x >= d) return 0.0;
  if (x >= b && x <= c) return 1.0;
  if (x > a && x < b) return (x - a) / (b - a);   // rising edge
  if (x > c && x < d) return (d - x) / (d - c);   // falling edge
  return 0.0;
}

// Membership function boundaries, tuned to THIS project's calibrated sensor
// output range (observed baseline ~5, breathing-test spike ~40 for CO2, etc.)
// -- NOT the same absolute ppm ranges as the base paper's industrial sensors,
// since our sensors and calibration method produce a different output scale.
// These are a reasonable starting point and can be refined with more data.

FuzzyDegrees classifyCO2(float x) {
  FuzzyDegrees d;
  d.low    = trapezoid(x, 0, 0, 8, 14);
  d.medium = trapezoid(x, 8, 14, 24, 30);
  d.high   = trapezoid(x, 24, 30, 1000, 1000);
  return d;
}

FuzzyDegrees classifyCO(float x) {
  FuzzyDegrees d;
  d.low    = trapezoid(x, 0, 0, 0.9, 1.3);
  d.medium = trapezoid(x, 0.9, 1.3, 1.8, 2.2);
  d.high   = trapezoid(x, 1.8, 2.2, 1000, 1000);
  return d;
}

FuzzyDegrees classifySmoke(float x) {
  FuzzyDegrees d;
  d.low    = trapezoid(x, 0, 0, 7, 10);
  d.medium = trapezoid(x, 7, 10, 15, 18);
  d.high   = trapezoid(x, 15, 18, 1000, 1000);
  return d;
}

// Picks whichever membership (Low/Medium/High) has the highest degree for one gas
// -- this is the standard "max membership" method for turning fuzzy degrees into
// a single dominant category per input, before applying the rule base.
int dominantClass(FuzzyDegrees d) { // 0=Low, 1=Medium, 2=High
  if (d.high >= d.medium && d.high >= d.low) return 2;
  if (d.medium >= d.low) return 1;
  return 0;
}

// Rule base -- same structure as the base paper's fuzzy logic (Section III-A):
// Safe only if ALL inputs are Low. Danger if ANY input is High. Otherwise Warning.
String fuzzySafetyRating(float co2, float co, float smoke) {
  int c2 = dominantClass(classifyCO2(co2));
  int c1 = dominantClass(classifyCO(co));
  int c3 = dominantClass(classifySmoke(smoke));

  if (c2 == 2 || c1 == 2 || c3 == 2) return "Danger";
  if (c2 == 0 && c1 == 0 && c3 == 0) return "Safe";
  return "Warning";
}

// ---------- WIFI ----------
void connectWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected. IP address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nWiFi connection FAILED - will keep logging locally, retry later.");
  }
}

// Sends one reading to the cloud backend as JSON, matching the shape
// the Flask /readings endpoint expects (same fields the test script sends).
void uploadReading(float co2, float co, float smoke, String safety) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Skipping upload - WiFi not connected.");
    return;
  }

  HTTPClient http;
  http.begin(BACKEND_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(45000); // 45 sec - Render free tier can take 30-50s to wake from sleep

  // Build the JSON body manually (simple enough not to need a JSON library for just 4 fields)
  String payload = "{";
  payload += "\"co2_ppm\":" + String(co2, 1) + ",";
  payload += "\"co_ppm\":" + String(co, 1) + ",";
  payload += "\"smoke_ppm\":" + String(smoke, 1) + ",";
  payload += "\"safety_rating\":\"" + safety + "\"";
  payload += "}";

  int httpResponseCode = http.POST(payload);

  if (httpResponseCode > 0) {
    Serial.print("Uploaded. Server responded: ");
    Serial.println(httpResponseCode);
  } else {
    Serial.print("Upload failed. Error: ");
    Serial.println(http.errorToString(httpResponseCode));
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12); // 0-4095

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED not found!");
  }
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("IVEMPS-Lite");
  display.println("Warming up sensors...");
  display.display();

  Serial.println("IVEMPS-Lite Week 1 boot complete.");
  Serial.println("NOTE: Let sensors run 24-48h before trusting readings (burn-in).");

  connectWiFi();
}

void loop() {
  unsigned long now = millis();
  if (now - lastRead >= READ_INTERVAL) {
    lastRead = now;

    float rs135 = readRs(PIN_MQ135, RL_MQ135);
    float rs7   = readRs(PIN_MQ7,   RL_MQ7);
    float rs2   = readRs(PIN_MQ2,   RL_MQ2);

    float co2ppm   = rsToPpm(rs135, Ro_MQ135, MQ135_A, MQ135_B);
    float coppm    = rsToPpm(rs7,   Ro_MQ7,   MQ7_A,   MQ7_B);
    float smokeppm = rsToPpm(rs2,   Ro_MQ2,   MQ2_A,   MQ2_B);

    // EWMA smoothing (init on first valid read)
    ewma_CO2   = (ewma_CO2 < 0)   ? co2ppm   : ALPHA * co2ppm   + (1 - ALPHA) * ewma_CO2;
    ewma_CO    = (ewma_CO < 0)    ? coppm    : ALPHA * coppm    + (1 - ALPHA) * ewma_CO;
    ewma_Smoke = (ewma_Smoke < 0) ? smokeppm : ALPHA * smokeppm + (1 - ALPHA) * ewma_Smoke;

    // ---------- FUZZY LOGIC CLASSIFICATION ----------
    String safetyRating = fuzzySafetyRating(ewma_CO2, ewma_CO, ewma_Smoke);

    // Serial output for logging / debugging
    Serial.print("CO2(ppm): "); Serial.print(ewma_CO2, 1);
    Serial.print(" | CO(ppm): "); Serial.print(ewma_CO, 1);
    Serial.print(" | Smoke/HC(ppm): "); Serial.print(ewma_Smoke, 1);
    Serial.print(" | Safety: "); Serial.println(safetyRating);

    // ---------- WIFI UPLOAD (own timer, every UPLOAD_INTERVAL) ----------
    // Separate from the 3-second sensor read timer, so we don't spam the
    // server with a request every single sensor read - same non-blocking
    // millis() pattern we used for sensor timing.
    if (millis() - lastUpload >= UPLOAD_INTERVAL) {
      lastUpload = millis();
      uploadReading(ewma_CO2, ewma_CO, ewma_Smoke, safetyRating);
    }

    // OLED output
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("IVEMPS-Lite  Live");
    display.print("CO2:  "); display.println(ewma_CO2, 0);
    display.print("CO:   "); display.println(ewma_CO, 0);
    display.print("Smoke:"); display.println(ewma_Smoke, 0);
    display.print("Status: "); display.println(safetyRating);
    display.display();
  }
}
