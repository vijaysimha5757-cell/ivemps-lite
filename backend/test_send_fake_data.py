"""
Simulates the ESP32 sending sensor readings to the Flask backend.
Run this WHILE app.py is running, in a second terminal window.
This proves the backend works correctly before any real hardware is involved.
"""

import requests
import random
import time

URL = "https://ivemps-lite-backend.onrender.com/readings"

def fake_safety_rating(co2, co, smoke):
    # Very rough placeholder logic — real fuzzy logic comes in Week 2
    if co > 50 or smoke > 300:
        return "Danger"
    elif co > 20 or smoke > 150:
        return "Warning"
    else:
        return "Safe"

for i in range(15):
    co2 = round(random.uniform(400, 1500), 1)
    co = round(random.uniform(1, 60), 1)
    smoke = round(random.uniform(10, 400), 1)
    rating = fake_safety_rating(co2, co, smoke)

    payload = {
        "co2_ppm": co2,
        "co_ppm": co,
        "smoke_ppm": smoke,
        "safety_rating": rating
    }

    response = requests.post(URL, json=payload)
    print(f"Sent: {payload}")
    print(f"Status code: {response.status_code}")
    print(f"Raw response text: {response.text[:500]}")  # first 500 chars, in case it's a big HTML error page
    print("-" * 40)

    time.sleep(2)

print("\nDone sending fake data. Now check http://127.0.0.1:5000/readings/latest in your browser.")
