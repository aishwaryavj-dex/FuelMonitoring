#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ------------------------------------------------------------
// Smart Fuel Corrosion Analyzer - ESP32 Dev Module Version
// LCD display via I2C module (address 0x27)
// Sends JSON over WiFi (HTTP POST) to your Flask backend
// ------------------------------------------------------------

// --- WiFi credentials (EDITED) ---
const char* ssid = "aishu";
const char* password = "trick@777";

// --- Render server endpoint (REPLACE with your actual Render URL) ---
const char* serverUrl = "https://fuelmonitoring.onrender.com/api/sensor-data";

// --- LCD Setup (I2C address 0x27, 16 columns, 2 rows) ---
LiquidCrystal_I2C lcd(0x27, 16, 2);

// --- Pin Definitions (ESP32 Dev Module) ---
#define WATER_SENSOR_PIN 34   // Must be an ADC1 pin (32-39) - ADC2 conflicts with WiFi
#define DHT_PIN 4             // DHT11 data pin
#define DHT_TYPE DHT11
#define BUZZER_PIN 25         // Passive buzzer signal pin
// I2C SDA = GPIO21, SCL = GPIO22 (ESP32 defaults, no need to set manually)

DHT dht(DHT_PIN, DHT_TYPE);

// --- Calibration (ESP32 ADC is 12-bit: 0-4095, NOT 0-1023 like Uno) ---
// Dip the sensor fully in liquid, read the raw value via Serial Monitor,
// and set SENSOR_MAX to that number.
const int SENSOR_MIN = 0;     // Raw value when empty
const int SENSOR_MAX = 2400;  // Raw value when full - RECALIBRATE THIS

unsigned long lastSend = 0;
const unsigned long sendInterval = 2000; // ms between POSTs

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
}

void connectWiFi() {
  lcd.setCursor(0, 0);
  lcd.print("Connecting WiFi");
  WiFi.begin(ssid, password);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(300);
    Serial.print(".");
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
    Serial.println("\nWiFi FAILED - check SSID/password");
    lcd.setCursor(0, 0);
    lcd.print("WiFi FAILED");
    delay(1500);
  }
  lcd.clear();
}

void loop() {
  // Reconnect WiFi if it drops
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Read fuel level sensor
  int rawValue = analogRead(WATER_SENSOR_PIN);
  int fuelPercent = map(rawValue, SENSOR_MIN, SENSOR_MAX, 0, 100);
  fuelPercent = constrain(fuelPercent, 0, 100);

  // Read temperature/humidity from DHT11
  float temp = dht.readTemperature();
  float humidity = dht.readHumidity();

  // --- Corrosion estimation logic (same as before) ---
  static float corrosionLevel = 0.0;
  if (!isnan(humidity) && !isnan(temp)) {
    float corrosionRate = (humidity / 100.0) * (temp / 50.0) * 0.05;
    corrosionLevel += corrosionRate;
    corrosionLevel = constrain(corrosionLevel, 0, 100);
  }

  // --- LCD Line 1: Fuel level ---
  lcd.setCursor(0, 0);
  lcd.print("Fuel:");
  lcd.print(fuelPercent);
  lcd.print("%   ");

  // --- LCD Line 2: Corrosion level (default) ---
  lcd.setCursor(0, 1);
  lcd.print("Corrosion:");
  lcd.print((int)corrosionLevel);
  lcd.print("%  ");

  bool lowFuel = fuelPercent < 20;
  bool highCorrosion = corrosionLevel > 70;

  // Buzzer alert + LCD override if thresholds breached
  if (lowFuel || highCorrosion) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(BUZZER_PIN, LOW);

    lcd.setCursor(0, 1);
    if (lowFuel) lcd.print("!! LOW FUEL !!  ");
    else if (highCorrosion) lcd.print("!! CORROSION !! ");
  }

  // Send to Flask over WiFi every interval
  if (millis() - lastSend >= sendInterval) {
    lastSend = millis();
    sendData(fuelPercent, (int)corrosionLevel,
              isnan(temp) ? 0 : temp,
              isnan(humidity) ? 0 : humidity);
  }
}

void sendData(int fuel, int corrosion, float temp, float humidity) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected – skipping send");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Disable cert validation (ESP32 limitation)

  HTTPClient http;
  http.begin(client, serverUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");
  http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS); // Follow any redirects

  // Build JSON payload safely with ArduinoJson
  StaticJsonDocument<200> doc;
  doc["fuel"] = fuel;
  doc["corrosion"] = corrosion;
  doc["temp"] = temp;
  doc["humidity"] = humidity;
  String payload;
  serializeJson(doc, payload);

  Serial.println("Sending: " + payload);
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
