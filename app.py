import os
import sqlite3
import datetime
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_socketio import SocketIO

# Initialize Flask application
app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)  # Enable CORS for API routes

# Configure secret key for session/socketio
app.config['SECRET_KEY'] = 'smart_fuel_secret_129837'

# Initialize Socket.IO
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='gevent')

# Database path configuration
DB_PATH = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'database.db')

def init_db():
    """Initializes the SQLite database and creates the readings table if it doesn't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            fuel INTEGER NOT NULL,
            corrosion INTEGER NOT NULL,
            temp REAL NOT NULL,
            humidity REAL NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

# Initialize DB on start
init_db()

def get_db_connection():
    """Helper to get a database connection with row factory configured."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/')
def index():
    """Serve the main dashboard page."""
    return render_template('index.html')

@app.route('/api/sensor-data', methods=['POST'])
def receive_sensor_data():
    """
    Accepts incoming sensor readings from ESP32 or curl client.
    Validates data contract fields and stores them in SQLite.
    Broadcasts the new reading to all connected frontend clients via Socket.IO.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON payload provided"}), 400

    # Validate the data contract fields
    required_fields = ['fuel', 'corrosion', 'temp', 'humidity']
    for field in required_fields:
        if field not in data:
            return jsonify({"error": f"Missing required field: {field}"}), 400

    try:
        # Extra validation of values
        fuel = int(data['fuel'])
        corrosion = int(data['corrosion'])
        temp = float(data['temp'])
        humidity = float(data['humidity'])

        if not (0 <= fuel <= 100):
            return jsonify({"error": "Fuel must be between 0 and 100"}), 400
        if not (0 <= corrosion <= 100):
            return jsonify({"error": "Corrosion must be between 0 and 100"}), 400
        if not (0 <= humidity <= 100):
            return jsonify({"error": "Humidity must be between 0 and 100"}), 400
    except (ValueError, TypeError) as e:
        return jsonify({"error": f"Invalid data types: {str(e)}"}), 400

    # Store in database with ISO datetime timestamp (local time)
    timestamp = datetime.datetime.now().isoformat()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO readings (timestamp, fuel, corrosion, temp, humidity) VALUES (?, ?, ?, ?, ?)',
        (timestamp, fuel, corrosion, temp, humidity)
    )
    conn.commit()
    reading_id = cursor.lastrowid
    conn.close()

    # Formulate output data object
    new_reading = {
        "id": reading_id,
        "timestamp": timestamp,
        "fuel": fuel,
        "corrosion": corrosion,
        "temp": temp,
        "humidity": humidity
    }

    # Broadcast via WebSockets
    socketio.emit('new_reading', new_reading)

    return jsonify({"status": "success", "data": new_reading}), 200

@app.route('/api/latest', methods=['GET'])
def get_latest_reading():
    """
    Returns the most recent reading, including a 'connected' boolean status.
    'connected' is False if no sensor reading has arrived in the last 10 seconds.
    """
    conn = get_db_connection()
    row = conn.execute('SELECT * FROM readings ORDER BY id DESC LIMIT 1').fetchone()
    conn.close()

    if not row:
        return jsonify({
            "connected": False,
            "reading": None
        }), 200

    reading = dict(row)
    
    # Calculate connection status: True if the latest reading is within the last 10 seconds
    try:
        reading_time = datetime.datetime.fromisoformat(reading['timestamp'])
        time_diff = (datetime.datetime.now() - reading_time).total_seconds()
        connected = time_diff <= 10.0
    except Exception:
        connected = False

    return jsonify({
        "connected": connected,
        "reading": reading
    }), 200

@app.route('/api/history', methods=['GET'])
def get_history():
    """
    Returns the last N records sorted chronologically for trending and plotting.
    N defaults to 50 but is configurable via the 'limit' query parameter.
    """
    limit = request.args.get('limit', default=50, type=int)
    if limit <= 0:
        return jsonify({"error": "Limit must be a positive integer"}), 400

    conn = get_db_connection()
    # Query N latest then order them chronologically
    rows = conn.execute(
        'SELECT * FROM (SELECT * FROM readings ORDER BY id DESC LIMIT ?) ORDER BY id ASC',
        (limit,)
    ).fetchall()
    conn.close()

    readings = [dict(row) for row in rows]
    return jsonify(readings), 200

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    debug_mode = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
