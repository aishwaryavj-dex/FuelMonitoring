# Smart Fuel Corrosion Analyzer Dashboard

This repository contains the backend and frontend for the **Smart Fuel Corrosion Analyzer** web dashboard. The system is designed to interface with an ESP32 IoT node that publishes fuel tank sensor measurements (fuel level, corrosion accumulation, ambient temperature, relative humidity) via HTTP POST.

The backend is written in Python (Flask) with an SQLite database and WebSockets (Socket.IO) for instant updates. The frontend uses a highly aesthetic, responsive dark-theme layout with custom circular gauges, key-value summaries, a live event log, and historical level/corrosion trends.

## Features

- **Real-Time Data Feed**: Leverages WebSockets to push new readings straight to the page, with automatic HTTP polling fallback if Socket.IO gets disconnected.
- **Visual Analytics**: Interactive circular gauges for Fuel Level and Corrosion Accumulation, range bars for temperature/humidity, and a historical trend line chart.
- **Intelligent Alert System**: Automatically triggers a flashing red warning banner if fuel level is critical (<20%) or corrosion is severe (>70%).
- **Smart Event Log**: Retains and formats timestamped state changes and warning logs, pre-populated with historical entries.
- **Connection Health Checks**: Monitors connection state. If no data arrives from the hardware for 10 seconds, the status indicator automatically transitions to "Disconnected - retrying..." (pulsing badge).

## Tech Stack

- **Backend**: Python 3, Flask, SQLite, Flask-CORS, Flask-SocketIO, eventlet
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6), Chart.js (CDN), Lucide Icons (CDN), Socket.IO Client (CDN)

---

## Installation & Setup

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Run the Flask server**:
   ```bash
   python app.py
   ```
   The application binds to port `5000` on host `0.0.0.0`, enabling ESP32 devices on the local network to send sensor readings directly to your computer.

3. **Open the Dashboard**:
   Open a web browser and navigate to:
   [http://localhost:5000](http://localhost:5000)

---

## Testing Without Hardware

To verify dashboard behavior and test interactions before deployment on the ESP32, simulate incoming readings by executing `curl` commands in your terminal.

### Send Normal Reading
```bash
curl -X POST http://localhost:5000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{"fuel": 68, "corrosion": 15, "temp": 24.2, "humidity": 45.5}'
```

### Send Low Fuel Alert Reading (Fuel < 20%)
```bash
curl -X POST http://localhost:5000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{"fuel": 12, "corrosion": 28, "temp": 28.1, "humidity": 59.4}'
```

### Send Severe Corrosion Alert Reading (Corrosion > 70%)
```bash
curl -X POST http://localhost:5000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{"fuel": 55, "corrosion": 82, "temp": 31.4, "humidity": 78.2}'
```

### Send Double Alert Reading
```bash
curl -X POST http://localhost:5000/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{"fuel": 8, "corrosion": 94, "temp": 35.0, "humidity": 82.5}'
```
