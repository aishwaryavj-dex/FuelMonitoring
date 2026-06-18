// ============================================================
//  Smart Fuel Corrosion Analyzer – ESP32 (with LCD)
//  Sends JSON over HTTPS to Vercel‑hosted Flask backend
// ============================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>      // ArduinoJson (>= 6) – install via Library Manager
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ------------------------------------------------------------
//  ★★ USER CONFIGURATION ★★
// ------------------------------------------------------------
const char* ssid     = "YOUR_SSID";        // ← edit
const char* password = "YOUR_PASSWORD";    // ← edit

// Vercel endpoint – includes the API route
const char* serverUrl = "https://fuel-monitoring-sand.vercel.app/api/sensor-data";

// ------------------------------------------------------------
//  Hardware configuration
// ------------------------------------------------------------
LiquidCrystal_I2C lcd(0x27, 16, 2);   // I2C LCD (0x27, 16×2)

#define WATER_SENSOR_PIN 34            // ADC1 pin (32‑39) – fuel level sensor
#define DHT_PIN          4
#define DHT_TYPE         DHT11
#define BUZZER_PIN       25

DHT dht(DHT_PIN, DHT_TYPE);

// ADC calibration – adjust after you know the raw empty / full values
const int SENSOR_MIN = 0;     // raw when tank empty
const int SENSOR_MAX = 2400;  // raw when tank full (re‑calibrate)

// ------------------------------------------------------------
//  Timing
// ------------------------------------------------------------
unsigned long lastSend = 0;
const unsigned long sendInterval = 2000;   // ms between POSTs

// ------------------------------------------------------------
//  Helper – Wi‑Fi connection (with LCD feedback)
// ------------------------------------------------------------
void connectWiFi() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");

  WiFi.begin(ssid, password);
  uint8_t attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(300);
    Serial.print('.');
    attempts++;
  }

  lcd.clear();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi connected: " + WiFi.localIP().toString());
    lcd.setCursor(0, 0);
    lcd.print("WiFi OK");
    lcd.setCursor(0, 1);
    lcd.print(WiFi.localIP().toString());
    delay(1200);
  } else {
    Serial.println("\nWiFi FAILED – check SSID/password");
    lcd.setCursor(0, 0);
    lcd.print("WiFi FAILED");
    delay(1500);
  }
  lcd.clear();
}

// ------------------------------------------------------------
//  Setup
// ------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(BUZZER_PIN, OUTPUT);

  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Smart Fuel");
  lcd.setCursor(0, 1);
  lcd.print("Corrosion Anlzr");
  delay(1500);
  lcd.clear();

  connectWiFi();

  // Optional: sync time for TLS (not required when we disable verification)
  // configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

// ------------------------------------------------------------
//  Main loop
// ------------------------------------------------------------
void loop() {
  // Auto‑reconnect if Wi‑Fi drops
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // ----- Fuel level (ADC) ---------------------------------
  int rawValue   = analogRead(WATER_SENSOR_PIN);
  int fuelPct    = map(rawValue, SENSOR_MIN, SENSOR_MAX, 0, 100);
  fuelPct        = constrain(fuelPct, 0, 100);

  // ----- Temperature / Humidity (DHT11) --------------------
  float temp     = dht.readTemperature();   // °C
  float humidity = dht.readHumidity();      // %

  // ----- Corrosion estimation -----------------------------
  static float corrosionLevel = 0.0;
  if (!isnan(temp) && !isnan(humidity)) {
    float corrosionRate = (humidity / 100.0) * (temp / 50.0) * 0.05;
    corrosionLevel += corrosionRate;
    corrosionLevel = constrain(corrosionLevel, 0, 100);
  }

  // ----- LCD display ---------------------------------------
  lcd.setCursor(0, 0);
  lcd.print("Fuel:");
  lcd.print(fuelPct);
  lcd.print("%   ");

  lcd.setCursor(0, 1);
  lcd.print("Cor:");
  lcd.print((int)corrosionLevel);
  lcd.print("%   ");

  // ----- Buzzer alerts --------------------------------------
  bool lowFuel      = fuelPct < 20;
  bool highCorrosion = corrosionLevel > 70;
  if (lowFuel || highCorrosion) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);
    lcd.setCursor(0, 1);
    if (lowFuel)       lcd.print("!! LOW FUEL !!  ");
    else if (highCorrosion) lcd.print("!! CORROSION !! ");
  }

  // ----- Periodic POST to Vercel ---------------------------
  if (millis() - lastSend >= sendInterval) {
    lastSend = millis();
    sendData(fuelPct,
             (int)corrosionLevel,
             isnan(temp) ? 0 : temp,
             isnan(humidity) ? 0 : humidity);
  }
}

// ------------------------------------------------------------
//  Send JSON payload to Vercel (HTTPS – insecure to avoid CA issues)
// ------------------------------------------------------------
void sendData(int fuel, int corrosion, float temp, float humidity) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected – skip send");
    return;
  }

  HTTPClient http;
  http.begin(serverUrl);
  // On ESP32 the default TLS verification fails without a root CA.
  // We deliberately disable verification for simplicity (not recommended for production).
  http.setInsecure();
  http.addHeader("Content-Type", "application/json");

  // Build JSON with ArduinoJson (compact & safe)
  StaticJsonDocument<200> doc;
  doc["fuel"]      = fuel;
  doc["corrosion"] = corrosion;
  doc["temp"]      = temp;
  doc["humidity"]  = humidity;

  String payload;
  serializeJson(doc, payload);

  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    Serial.printf("POST %d – %s\n", httpCode, payload.c_str());
    String resp = http.getString();
    Serial.println("Response: " + resp);
  } else {
    Serial.printf("POST failed: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}
