import os, json, datetime, sqlite3

DB_PATH = os.path.join(os.path.abspath(os.path.dirname(__file__)), '../../database.db')

def handler(event, context):
    """Netlify Function handling POST /sensor-data"""
    if event.get('httpMethod') != 'POST':
        return {
            "statusCode": 405,
            "body": json.dumps({"error": "Method Not Allowed"}),
            "headers": {"Content-Type": "application/json"},
        }

    try:
        data = json.loads(event.get('body') or '{}')
    except Exception:
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "Invalid JSON"}),
            "headers": {"Content-Type": "application/json"},
        }

    # Validate required fields
    for field in ('fuel', 'corrosion', 'temp', 'humidity'):
        if field not in data:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": f"Missing field: {field}"}),
                "headers": {"Content-Type": "application/json"},
            }

    # Cast / range‑check
    try:
        fuel = int(data['fuel'])
        corrosion = int(data['corrosion'])
        temp = float(data['temp'])
        humidity = float(data['humidity'])
        if not (0 <= fuel <= 100 and 0 <= corrosion <= 100 and 0 <= humidity <= 100):
            raise ValueError
    except (ValueError, TypeError):
        return {
            "statusCode": 400,
            "body": json.dumps({"error": "Invalid field values"}),
            "headers": {"Content-Type": "application/json"},
        }

    # Insert into DB
    timestamp = datetime.datetime.now().isoformat()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO readings (timestamp, fuel, corrosion, temp, humidity) VALUES (?,?,?,?,?)',
        (timestamp, fuel, corrosion, temp, humidity)
    )
    conn.commit()
    reading_id = cur.lastrowid
    conn.close()

    new_reading = {
        "id": reading_id,
        "timestamp": timestamp,
        "fuel": fuel,
        "corrosion": corrosion,
        "temp": temp,
        "humidity": humidity,
    }

    return {
        "statusCode": 200,
        "body": json.dumps({"status": "success", "data": new_reading}),
        "headers": {"Content-Type": "application/json"},
    }
