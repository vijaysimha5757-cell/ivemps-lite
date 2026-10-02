"""
Sends ONE guaranteed Danger-level reading to test the WhatsApp alert
end-to-end, without relying on random fake data happening to produce one.
"""

import requests

URL = "https://ivemps-lite-backend.onrender.com/readings"  # <-- put your real Render URL here

payload = {
    "co2_ppm": 999.9,
    "co_ppm": 999.9,
    "smoke_ppm": 999.9,
    "safety_rating": "Danger"
}

response = requests.post(URL, json=payload)
print(f"Status code: {response.status_code}")
print(f"Response: {response.text}")
print("\nCheck your WhatsApp now - an alert should arrive within a few seconds.")
