"""
IVEMPS-Lite Backend — Week 1/2 skeleton
Flask + SQLAlchemy (SQLite for now, easy to swap to PostgreSQL later
by just changing the DATABASE_URL — same code, no rewrite needed)

Endpoints:
  POST /readings         -> ESP32 sends a new sensor reading here
  GET  /readings/latest   -> dashboard asks: "what's the most recent reading?"
  GET  /readings          -> dashboard asks: "give me history" (for the graph)
  GET  /forecast           -> stub for now, Week 3 will fill this in with the ML model
"""

from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from datetime import datetime

app = Flask(__name__)
CORS(app)  # allows requests from ANY frontend domain — fine for a student project/demo

# ---------- DATABASE CONFIG ----------
# SQLite for local development: creates a single file "ivemps.db" in this folder.
# Later, to move to PostgreSQL (cloud), we ONLY change this one line —
# nothing else in the code changes. That's the benefit of using an ORM (SQLAlchemy).
import os

app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///ivemps.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ---------- DATABASE MODEL ----------
# This class defines the "shape" of one row in our readings table.
# Think of it as designing the columns of a spreadsheet.
class Reading(db.Model):
    id = db.Column(db.Integer, primary_key=True)          # auto-incrementing row ID
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)  # when it was recorded
    co2_ppm = db.Column(db.Float, nullable=False)
    co_ppm = db.Column(db.Float, nullable=False)
    smoke_ppm = db.Column(db.Float, nullable=False)
    safety_rating = db.Column(db.String(20), default="Unknown")  # Safe / Warning / Danger

    def to_dict(self):
        # Converts a database row into a plain Python dictionary,
        # which Flask can then easily turn into JSON to send to the dashboard.
        return {
            "id": self.id,
            "timestamp": self.timestamp.isoformat(),
            "co2_ppm": self.co2_ppm,
            "co_ppm": self.co_ppm,
            "smoke_ppm": self.smoke_ppm,
            "safety_rating": self.safety_rating,
        }

# Create the database file + table the first time the app runs
with app.app_context():
    db.create_all()

# ---------- ROUTES (ENDPOINTS) ----------

@app.route('/readings', methods=['POST'])
def add_reading():
    """
    ESP32 (or our test script) sends a JSON body like:
    {
        "co2_ppm": 420.5,
        "co_ppm": 3.2,
        "smoke_ppm": 15.0,
        "safety_rating": "Safe"
    }
    """
    data = request.get_json()

    if not data or "co2_ppm" not in data:
        return jsonify({"error": "Missing required fields"}), 400

    new_reading = Reading(
        co2_ppm=data.get("co2_ppm"),
        co_ppm=data.get("co_ppm"),
        smoke_ppm=data.get("smoke_ppm"),
        safety_rating=data.get("safety_rating", "Unknown"),
    )
    db.session.add(new_reading)
    db.session.commit()

    return jsonify({"message": "Reading saved", "data": new_reading.to_dict()}), 201


@app.route('/readings/latest', methods=['GET'])
def get_latest_reading():
    """Dashboard calls this to show the current live values."""
    latest = Reading.query.order_by(Reading.id.desc()).first()
    if not latest:
        return jsonify({"message": "No readings yet"}), 404
    return jsonify(latest.to_dict())


@app.route('/readings', methods=['GET'])
def get_all_readings():
    """Dashboard calls this to draw the historical graph. Returns last 200 readings."""
    readings = Reading.query.order_by(Reading.id.desc()).limit(200).all()
    return jsonify([r.to_dict() for r in reversed(readings)])


@app.route('/forecast', methods=['GET'])
def get_forecast():
    """
    Placeholder for now — Week 3 we'll plug in the trained ML model here.
    Returning a dummy response so the frontend can already be built against
    this endpoint without waiting for the model to exist.
    """
    return jsonify({
        "message": "Forecast model not trained yet — placeholder response",
        "predicted_co2_ppm": None,
        "predicted_safety_rating": "Unknown"
    })


@app.route('/', methods=['GET'])
def health_check():
    """Simple route to confirm the server is alive — visit this in a browser to test."""
    return jsonify({"status": "IVEMPS-Lite backend is running"})


if __name__ == '__main__':
    # host='0.0.0.0' makes it reachable from other devices on the same WiFi
    # (important later — your ESP32 needs to reach this server over WiFi)
    app.run(host='0.0.0.0', port=5000, debug=True)
