"""
IVEMPS-Lite — Synthetic driving-cycle dataset generator

WHY THIS EXISTS:
Real, free, time-series vehicle emission datasets are hard to access
(mostly institutional/paywalled). So we simulate a realistic driving
cycle ourselves: speed/RPM that behaves like a real trip (idle -> 
accelerate -> cruise -> brake -> idle, repeated), and emissions that
correlate with those driving conditions plus realistic noise.

This dataset is used to BOOTSTRAP the forecasting model now. Once real
ESP32 sensor data is being collected (Day 2 onward), that real data
should be blended in / used to fine-tune the same pipeline.

Output: synthetic_driving_data.csv with columns:
  timestamp, speed_kmh, rpm, co2_ppm, co_ppm, smoke_ppm, safety_rating
"""

import numpy as np
import pandas as pd
import datetime

np.random.seed(42)  # makes results reproducible - same "random" data every run

# ---------- SIMULATE A DRIVING CYCLE ----------
duration_seconds = 3600 * 2  # 2 hours of simulated driving, sampled every 3 sec (matches our real sensor sampling rate)
sample_interval = 3
n_samples = duration_seconds // sample_interval

time_index = np.arange(n_samples)

# Build a repeating pattern: idle -> accelerate -> cruise -> decelerate -> idle
# using a sine wave (smooth, realistic-looking speed changes) plus some randomness
cycle_length = 200  # samples per "phase" of driving
speed = 40 + 35 * np.sin(2 * np.pi * time_index / cycle_length) 
speed = np.clip(speed + np.random.normal(0, 5, n_samples), 0, 120)  # add noise, clip to realistic range 0-120 km/h

# RPM roughly follows speed (higher speed/acceleration -> higher RPM), with idle floor
rpm = 800 + speed * 25 + np.random.normal(0, 150, n_samples)
rpm = np.clip(rpm, 700, 5000)

# ---------- SIMULATE EMISSIONS BASED ON DRIVING CONDITIONS ----------
# Core idea: emissions rise with speed/RPM (more fuel burned), acceleration spikes cause extra CO/HC,
# idle still has a baseline (engine running but not moving).

acceleration = np.gradient(speed)  # how fast speed is changing right now

co2_ppm = 600 + speed * 8 + np.random.normal(0, 40, n_samples)
co_ppm = 5 + (rpm / 5000) * 40 + np.abs(acceleration) * 3 + np.random.normal(0, 3, n_samples)
smoke_ppm = 20 + (rpm / 5000) * 200 + np.abs(acceleration) * 15 + np.random.normal(0, 15, n_samples)

co2_ppm = np.clip(co2_ppm, 400, 3000)
co_ppm = np.clip(co_ppm, 0, 200)
smoke_ppm = np.clip(smoke_ppm, 0, 800)

# Occasionally inject a "high emission event" (simulates a HEV / high-emitting moment,
# e.g. hard acceleration, engine issue) so the dataset has some real Danger examples
# -- otherwise, like the real base paper found, Danger events are rare and the model
# never learns to recognize them at all.
#
# IMPORTANT: these are BURSTS lasting several consecutive samples (not single isolated
# points). Real emission events build up and last a few seconds - and just as importantly,
# a burst gives the model an actual LEAD-UP pattern in the preceding window to learn from.
# A single random isolated spike has no precursor signal at all, so a forecasting model
# has literally nothing to learn - that was the bug in the first version of this script.
n_events = 40
for _ in range(n_events):
    start = np.random.randint(0, n_samples - 40)
    burst_len = np.random.randint(15, 35)  # 45-105 seconds of elevated emissions
    end = start + burst_len

    # ramp up, hold, ramp down - smoother and more realistic than a flat block
    ramp = np.linspace(0, 1, burst_len // 3)
    hold = np.ones(burst_len - 2 * len(ramp))
    shape = np.concatenate([ramp, hold, ramp[::-1]])

    co_ppm[start:start + len(shape)] += shape * np.random.uniform(50, 90)
    smoke_ppm[start:start + len(shape)] += shape * np.random.uniform(250, 450)

# ---------- FUZZY-STYLE SAFETY RATING (simplified version of our fuzzy logic) ----------
def classify(co, smoke):
    if co > 50 or smoke > 350:
        return "Danger"
    elif co > 20 or smoke > 150:
        return "Warning"
    else:
        return "Safe"

safety_rating = [classify(c, s) for c, s in zip(co_ppm, smoke_ppm)]

# ---------- BUILD TIMESTAMPS AND SAVE ----------
start_time = datetime.datetime.now() - datetime.timedelta(seconds=duration_seconds)
timestamps = [start_time + datetime.timedelta(seconds=int(i * sample_interval)) for i in time_index]

df = pd.DataFrame({
    "timestamp": timestamps,
    "speed_kmh": np.round(speed, 1),
    "rpm": np.round(rpm, 0),
    "co2_ppm": np.round(co2_ppm, 1),
    "co_ppm": np.round(co_ppm, 1),
    "smoke_ppm": np.round(smoke_ppm, 1),
    "safety_rating": safety_rating
})

df.to_csv("synthetic_driving_data.csv", index=False)

print(f"Generated {len(df)} rows of synthetic driving data.")
print(df["safety_rating"].value_counts())
print("\nSaved to synthetic_driving_data.csv")
print(df.head(10))
