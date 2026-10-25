"""
IVEMPS-Lite - retrain the forecasting model on REAL data collected by the device.

USAGE
  1. Export the `reading` table from Supabase as CSV and save it in this folder
     as  reading_export.csv   (or pass a different path:  python train_from_real_data.py my.csv)
  2. python train_from_real_data.py
  3. Read the metrics. If they look sensible, copy safety_forecast_model_real.pkl
     into the backend folder and rename it to safety_forecast_model.pkl.

Same set-up as the earlier model: window W=10 readings in, label H=5 readings ahead.
Readings are ~3 s apart, so that is 30 s of history and a ~15 s forecast.

EVALUATION: with a short session there are only a handful of Warning/Danger episodes, so one
70/30 split can leave the test set with almost none of them. Instead the windows are cut into
K contiguous blocks; each block is tested in turn while the model is trained on the others
(with a gap either side so overlapping windows cannot leak). Pooled results are reported next
to two honest baselines: "always say Safe" and "assume the future equals the present".
"""

import sys
import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, classification_report, confusion_matrix

CSV_PATH = sys.argv[1] if len(sys.argv) > 1 else "reading_export.csv"
W, H = 10, 5
MAX_GAP_SECONDS = 10          # a window spanning a longer pause (device off, WiFi drop) is discarded
FEATURES = ["co2_ppm", "co_ppm", "smoke_ppm"]
LABELS = {"Safe": 0, "Warning": 1, "Danger": 2}
NAMES = ["Safe", "Warning", "Danger"]

# ---------- load ----------
df = pd.read_csv(CSV_PATH)
needed = ["timestamp", "safety_rating"] + FEATURES
missing = [c for c in needed if c not in df.columns]
if missing:
    sys.exit(f"CSV is missing columns: {missing}. Found: {list(df.columns)}")

try:
    df["ts"] = pd.to_datetime(df["timestamp"], utc=True, format="ISO8601")
except Exception:
    df["ts"] = pd.to_datetime(df["timestamp"], utc=True)

df = df.sort_values("ts").reset_index(drop=True)
# MQ-sensor ppm formulas blow up outside the datasheet range (e.g. dense smoke gave millions of "ppm").
# Anything above this is just "saturated", so cap it - it cannot change a Danger label anyway.
SAT_PPM = 10000
n_sat = int((df[FEATURES] > SAT_PPM).any(axis=1).sum())
df[FEATURES] = df[FEATURES].clip(upper=SAT_PPM)
if n_sat:
    print(f"Note: capped {n_sat} saturated readings at {SAT_PPM} ppm.")
df = df[df["safety_rating"].isin(LABELS)].dropna(subset=FEATURES).reset_index(drop=True)
df["label"] = df["safety_rating"].map(LABELS)
df["dt"] = df["ts"].diff().dt.total_seconds()

print(f"Loaded {len(df)} usable rows from {CSV_PATH}")
print("Rows per class:\n", df["safety_rating"].value_counts().to_string(), "\n")
print(f"Median spacing between readings: {df['dt'].median():.1f} s "
      f"(model assumes ~3 s; if this is much larger, check UPLOAD_INTERVAL)\n")

# ---------- build windows (skipping any that cross a long gap) ----------
data = df[FEATURES].values
labels = df["label"].values
dts = df["dt"].values

X, y, y_now = [], [], []
for t in range(W, len(df) - H):
    span = dts[t - W + 1: t + H + 1]          # gaps inside [t-W, t+H]
    if np.nanmax(span) > MAX_GAP_SECONDS:
        continue
    X.append(data[t - W:t].flatten())
    y.append(labels[t + H])
    y_now.append(labels[t - 1])               # label right now, for the naive baseline

X, y, y_now = np.array(X), np.array(y), np.array(y_now)
print(f"Built {len(X)} training windows ({W} readings x {len(FEATURES)} gases each).")
if len(X) < 200:
    sys.exit("Too few usable windows. Collect a longer session (aim for 40-60 minutes without gaps).")

# ---------- how many distinct events do we really have? ----------
def episodes(arr, cls):
    hit = (arr == cls).astype(int)
    return int(((hit[1:] == 1) & (hit[:-1] == 0)).sum() + hit[0])

print(f"Distinct episodes in the data: Warning {episodes(y, 1)}, Danger {episodes(y, 2)}")
if episodes(y, 2) < 5 or episodes(y, 1) < 5:
    print("  WARNING: fewer than 5 separate Warning or Danger episodes. Any score below rests on very few "
          "events - treat it as indicative only, and collect more short, repeated events.\n")

# ---------- blocked cross-validation ----------
K = 5
PURGE = W + H
n = len(X)
edges = np.linspace(0, n, K + 1).astype(int)
oof = np.full(n, -1)

def new_model():
    return RandomForestClassifier(n_estimators=200, max_depth=12, class_weight="balanced", random_state=42)

for k in range(K):
    a, b = edges[k], edges[k + 1]
    train_mask = np.ones(n, dtype=bool)
    train_mask[max(0, a - PURGE): min(n, b + PURGE)] = False
    if len(np.unique(y[train_mask])) < 2:
        continue
    m = new_model().fit(X[train_mask], y[train_mask])
    oof[a:b] = m.predict(X[a:b])

ok = oof >= 0
truth, pred, now_label = y[ok], oof[ok], y_now[ok]
print(f"Evaluated on {ok.sum()} windows pooled over {K} blocks.")
print("Pooled class counts: " + str({NAMES[k]: int((truth == k).sum()) for k in range(3)}))

def report(title, truth, guess):
    acc = accuracy_score(truth, guess)
    f1w = f1_score(truth, guess, average="weighted", zero_division=0)
    f1d = f1_score(truth, guess, labels=[2], average="macro", zero_division=0)
    print(f"{title}: accuracy {acc*100:.1f}% | weighted F1 {f1w:.2f} | Danger F1 {f1d:.2f}")

print("\n===== RESULTS =====")
report("Always say Safe                      ", truth, np.zeros_like(truth))
report("Naive (future = present)             ", truth, now_label)
report("RandomForest forecast                ", truth, pred)

print("\nClassification report (pooled):")
print(classification_report(truth, pred, labels=[0, 1, 2], target_names=NAMES, zero_division=0))
print("Confusion matrix (rows=actual, cols=predicted; Safe, Warning, Danger):")
print(confusion_matrix(truth, pred, labels=[0, 1, 2]))

# ---------- final model: train on everything ----------
model = new_model().fit(X, y)
joblib.dump(model, "safety_forecast_model_real.pkl")
print("\nSaved safety_forecast_model_real.pkl  (NOT yet used by the backend)")
