#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET    -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

const int PIN_MQ135 = 34;
const int PIN_MQ7   = 35;
const int PIN_MQ2   = 32;

const float VCC = 3.3;
const float RL_MQ135 = 20.0;
const float RL_MQ7   = 10.0;
const float RL_MQ2   = 5.0;

float Ro_MQ135 = 10.0;
float Ro_MQ7   = 10.0;
float Ro_MQ2   = 10.0;

const float MQ135_A = 116.6020682, MQ135_B = -2.769034857;
const float MQ7_A   = 99.042,      MQ7_B   = -1.518;
const float MQ2_A   = 574.25,      MQ2_B   = -2.222;

const float ALPHA = 0.2;
float ewma_CO2 = -1, ewma_CO = -1, ewma_Smoke = -1;

unsigned long lastRead = 0;
const unsigned long READ_INTERVAL = 3000;

float readRs(int pin, float RL) {
  int adc = analogRead(pin);
  float vout = (adc / 4095.0) * VCC;
  if (vout < 0.01) vout = 0.01;
  float rs = ((VCC - vout) / vout) * RL;
  return rs;
}

float rsToPpm(float rs, float ro, float a, float b) {
  float ratio = rs / ro;
  if (ratio <= 0) ratio = 0.01;
  return a * pow(ratio, b);
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);

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

    ewma_CO2   = (ewma_CO2 < 0)   ? co2ppm   : ALPHA * co2ppm   + (1 - ALPHA) * ewma_CO2;
    ewma_CO    = (ewma_CO < 0)    ? coppm    : ALPHA * coppm    + (1 - ALPHA) * ewma_CO;
    ewma_Smoke = (ewma_Smoke < 0) ? smokeppm : ALPHA * smokeppm + (1 - ALPHA) * ewma_Smoke;

    Serial.print("CO2(ppm): "); Serial.print(ewma_CO2, 1);
    Serial.print(" | CO(ppm): "); Serial.print(ewma_CO, 1);
    Serial.print(" | Smoke/HC(ppm): "); Serial.println(ewma_Smoke, 1);

    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("IVEMPS-Lite  Live");
    display.print("CO2:  "); display.println(ewma_CO2, 0);
    display.print("CO:   "); display.println(ewma_CO, 0);
    display.print("Smoke:"); display.println(ewma_Smoke, 0);
    display.display();
  }
}