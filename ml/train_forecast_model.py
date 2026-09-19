"""
IVEMPS-Lite — Forecasting model training script

GOAL: predict the safety rating H steps INTO THE FUTURE, using a WINDOW of
W past readings as input. This mirrors the base paper's approach:
  - backcast window w = 10 (30 seconds of history)
  - forecast horizon H = 5  (15 seconds ahead)

We use RandomForestClassifier (scikit-learn) instead of the paper's N-HiTS
deep learning model - a reasonable, well-justified simplification given
project timeline, while still producing genuine accuracy/F1 metrics
we can report, just like the base paper's Table 6/7.
"""

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, classification_report, confusion_matrix
import joblib

# ---------- CONFIG (matches base paper's choices) ----------
W = 10   # backcast window: how many past readings we look at
H = 5    # forecast horizon: how many steps ahead we predict

FEATURES = ["co2_ppm", "co_ppm", "smoke_ppm"]  # only what the real ESP32 pipeline actually sends (OBD-II parked for now)
LABEL_MAP = {"Safe": 0, "Warning": 1, "Danger": 2}
INV_LABEL_MAP = {v: k for k, v in LABEL_MAP.items()}

# ---------- LOAD DATA ----------
df = pd.read_csv("synthetic_driving_data.csv")
df["label"] = df["safety_rating"].map(LABEL_MAP)

# ---------- BUILD WINDOWED FEATURES ----------
# For each point in time t, we gather the last W readings of each feature
# (flattened into one long row) as input X, and the label at t+H as the target y.
# This is exactly how you'd prepare data for ANY sequence-forecasting model,
# not just this one - a genuinely transferable ML concept worth understanding.

X, y = [], []
data = df[FEATURES].values
labels = df["label"].values

for t in range(W, len(df) - H):
    window = data[t - W:t].flatten()   # last W readings, all features, flattened into 1 row
    target = labels[t + H]             # the label H steps into the future
    X.append(window)
    y.append(target)

X = np.array(X)
y = np.array(y)

print(f"Built {len(X)} training examples, each with {X.shape[1]} input features (window={W} x {len(FEATURES)} features).")

# ---------- TRAIN / TEST SPLIT ----------
# Chronological split (not random!) - train on the FIRST 70% of the trip,
# test on the LAST 30% - mirrors the base paper's approach of training on
# early trips and testing on later trips, so the model is genuinely tested
# on "unseen future" data, not just randomly shuffled data from the same moments.
split_idx = int(len(X) * 0.7)
X_train, X_test = X[:split_idx], X[split_idx:]
y_train, y_test = y[:split_idx], y[split_idx:]

print(f"Train size: {len(X_train)}, Test size: {len(X_test)}")

# ---------- TRAIN MODEL ----------
model = RandomForestClassifier(
    n_estimators=200,
    max_depth=12,
    class_weight="balanced",  # important! compensates for Danger being a minority class
    random_state=42
)
model.fit(X_train, y_train)

# ---------- EVALUATE ----------
y_pred = model.predict(X_test)

acc = accuracy_score(y_test, y_pred)
f1_weighted = f1_score(y_test, y_pred, average="weighted")
f1_danger = f1_score(y_test, y_pred, labels=[LABEL_MAP["Danger"]], average="macro")

print("\n===== RESULTS (compare to base paper's Table 6/7) =====")
print(f"Accuracy: {acc*100:.1f}%")
print(f"F1-score (weighted): {f1_weighted:.2f}")
print(f"Danger F1-score: {f1_danger:.2f}")
print("\nFull classification report:")
print(classification_report(y_test, y_pred, target_names=["Safe", "Warning", "Danger"]))

print("Confusion matrix (rows=actual, cols=predicted, order: Safe, Warning, Danger):")
print(confusion_matrix(y_test, y_pred))

# ---------- SAVE THE TRAINED MODEL ----------
joblib.dump(model, "safety_forecast_model.pkl")
print("\nModel saved to safety_forecast_model.pkl")
