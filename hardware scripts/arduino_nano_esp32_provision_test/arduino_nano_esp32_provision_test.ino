#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

static const char *WIFI_SSID = "YOUR_WIFI_SSID";
static const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

static const char *BACKEND_BASE_URL = "https://your-backend-host";

static const char *DEVICE_ID = "dev_replace_me";
static const char *DEVICE_SECRET = "replace-with-device-secret";

static const char *FIREBASE_API_KEY = "your-firebase-web-api-key";
static const char *FIREBASE_DATABASE_URL = "https://your-project-default-rtdb.firebaseio.com";

static const bool ALLOW_INSECURE_TLS = true;

static const int MAX_PROVISION_ATTEMPTS = 8;
static const unsigned long PROVISION_RETRY_DELAY_MS = 5000;
static const unsigned long TELEMETRY_INTERVAL_MS = 10000;
static const unsigned long HTTP_CONNECT_TIMEOUT_MS = 15000;
static const unsigned long HTTP_TIMEOUT_MS = 20000;

bool firebaseReady = false;
unsigned long lastTelemetryWriteMs = 0;
unsigned long firebaseIdTokenExpiresAtMs = 0;

String provisionedDeviceId;
String firebaseCustomToken;
String firebaseUid;
String firebaseIdToken;
String firebaseRefreshToken;

bool isHttpsUrl(const String &url) {
  return url.startsWith("https://");
}

void configureHttpClient(HTTPClient &http) {
  http.addHeader("Content-Type", "application/json");
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
}

String urlEncode(const String &input) {
  const char *hex = "0123456789ABCDEF";
  String encoded;

  for (size_t i = 0; i < input.length(); i += 1) {
    const char current = input[i];

    if (
      (current >= 'a' && current <= 'z') ||
      (current >= 'A' && current <= 'Z') ||
      (current >= '0' && current <= '9') ||
      current == '-' ||
      current == '_' ||
      current == '.' ||
      current == '~'
    ) {
      encoded += current;
      continue;
    }

    encoded += '%';
    encoded += hex[(current >> 4) & 0x0F];
    encoded += hex[current & 0x0F];
  }

  return encoded;
}

bool postJson(const String &url, const String &payload, int &statusCode, String &responseBody) {
  HTTPClient http;

  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;

    if (ALLOW_INSECURE_TLS) {
      secureClient.setInsecure();
    }

    if (!http.begin(secureClient, url)) {
      Serial.println("Failed to initialize HTTPS client.");
      return false;
    }

    configureHttpClient(http);
    statusCode = http.POST(payload);
    responseBody = http.getString();
    http.end();
    return true;
  }

  WiFiClient client;
  if (!http.begin(client, url)) {
    Serial.println("Failed to initialize HTTP client.");
    return false;
  }

  configureHttpClient(http);
  statusCode = http.POST(payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool postForm(const String &url, const String &payload, int &statusCode, String &responseBody) {
  HTTPClient http;

  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;

    if (ALLOW_INSECURE_TLS) {
      secureClient.setInsecure();
    }

    if (!http.begin(secureClient, url)) {
      Serial.println("Failed to initialize HTTPS client.");
      return false;
    }

    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
    http.setTimeout(HTTP_TIMEOUT_MS);
    statusCode = http.POST(payload);
    responseBody = http.getString();
    http.end();
    return true;
  }

  WiFiClient client;
  if (!http.begin(client, url)) {
    Serial.println("Failed to initialize HTTP client.");
    return false;
  }

  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  statusCode = http.POST(payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool putJson(const String &url, const String &payload, int &statusCode, String &responseBody) {
  HTTPClient http;

  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;

    if (ALLOW_INSECURE_TLS) {
      secureClient.setInsecure();
    }

    if (!http.begin(secureClient, url)) {
      Serial.println("Failed to initialize HTTPS client.");
      return false;
    }

    configureHttpClient(http);
    statusCode = http.sendRequest("PUT", payload);
    responseBody = http.getString();
    http.end();
    return true;
  }

  WiFiClient client;
  if (!http.begin(client, url)) {
    Serial.println("Failed to initialize HTTP client.");
    return false;
  }

  configureHttpClient(http);
  statusCode = http.sendRequest("PUT", payload);
  responseBody = http.getString();
  http.end();
  return true;
}

void connectToWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("WiFi connected. IP: ");
  Serial.println(WiFi.localIP());
}

void ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.println("WiFi disconnected. Reconnecting...");
  WiFi.disconnect();
  connectToWifi();
}

bool provisionDevice() {
  const String endpoint = String(BACKEND_BASE_URL) + "/devices/provision";

  JsonDocument payloadDoc;
  payloadDoc["deviceId"] = DEVICE_ID;
  payloadDoc["deviceSecret"] = DEVICE_SECRET;

  String payload;
  serializeJson(payloadDoc, payload);

  for (int attempt = 1; attempt <= MAX_PROVISION_ATTEMPTS; attempt += 1) {
    int statusCode = -1;
    String responseBody;

    Serial.println();
    Serial.print("Provision attempt ");
    Serial.print(attempt);
    Serial.print(" of ");
    Serial.println(MAX_PROVISION_ATTEMPTS);

    if (!postJson(endpoint, payload, statusCode, responseBody)) {
      Serial.println("Provision request failed before receiving an HTTP response.");
    } else {
      Serial.print("Provision HTTP status: ");
      Serial.println(statusCode);
      Serial.println("Provision response:");
      Serial.println(responseBody);

      if (statusCode >= 200 && statusCode < 300) {
        JsonDocument responseDoc;
        const DeserializationError jsonError = deserializeJson(responseDoc, responseBody);

        if (jsonError) {
          Serial.print("Failed to parse provisioning response JSON: ");
          Serial.println(jsonError.c_str());
          return false;
        }

        firebaseCustomToken = String((const char *)(responseDoc["firebaseCustomToken"] | ""));
        firebaseUid = String((const char *)(responseDoc["firebaseUid"] | ""));
        provisionedDeviceId = String((const char *)(responseDoc["deviceId"] | ""));

        if (firebaseCustomToken.isEmpty() || provisionedDeviceId.isEmpty()) {
          Serial.println("Provision response is missing required fields.");
          return false;
        }

        Serial.println("Provisioning succeeded.");
        Serial.print("Firebase UID: ");
        Serial.println(firebaseUid);
        return true;
      }
    }

    if (attempt < MAX_PROVISION_ATTEMPTS) {
      Serial.print("Retrying provisioning in ");
      Serial.print(PROVISION_RETRY_DELAY_MS);
      Serial.println(" ms...");
      delay(PROVISION_RETRY_DELAY_MS);
    }
  }

  Serial.println("Provisioning failed after all retry attempts.");
  return false;
}

bool signInToFirebaseWithCustomToken() {
  const String endpoint =
    String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=") +
    FIREBASE_API_KEY;

  JsonDocument payloadDoc;
  payloadDoc["token"] = firebaseCustomToken;
  payloadDoc["returnSecureToken"] = true;

  String payload;
  serializeJson(payloadDoc, payload);

  int statusCode = -1;
  String responseBody;

  if (!postJson(endpoint, payload, statusCode, responseBody)) {
    Serial.println("Firebase sign-in request failed before receiving an HTTP response.");
    return false;
  }

  Serial.print("Firebase sign-in HTTP status: ");
  Serial.println(statusCode);
  Serial.println("Firebase sign-in response:");
  Serial.println(responseBody);

  if (statusCode < 200 || statusCode >= 300) {
    return false;
  }

  JsonDocument responseDoc;
  const DeserializationError jsonError = deserializeJson(responseDoc, responseBody);

  if (jsonError) {
    Serial.print("Failed to parse Firebase sign-in response JSON: ");
    Serial.println(jsonError.c_str());
    return false;
  }

  firebaseIdToken = String((const char *)(responseDoc["idToken"] | ""));
  firebaseRefreshToken = String((const char *)(responseDoc["refreshToken"] | ""));
  const unsigned long expiresInSeconds =
    String((const char *)(responseDoc["expiresIn"] | "3600")).toInt();

  if (firebaseIdToken.isEmpty() || firebaseRefreshToken.isEmpty()) {
    Serial.println("Firebase sign-in response is missing tokens.");
    return false;
  }

  firebaseIdTokenExpiresAtMs = millis() + (expiresInSeconds * 1000UL);
  firebaseReady = true;

  Serial.println("Firebase sign-in succeeded.");
  return true;
}

bool refreshFirebaseIdToken() {
  if (firebaseRefreshToken.isEmpty()) {
    Serial.println("No Firebase refresh token available.");
    return false;
  }

  const String endpoint =
    String("https://securetoken.googleapis.com/v1/token?key=") + FIREBASE_API_KEY;
  const String payload =
    "grant_type=refresh_token&refresh_token=" + urlEncode(firebaseRefreshToken);

  int statusCode = -1;
  String responseBody;

  if (!postForm(endpoint, payload, statusCode, responseBody)) {
    Serial.println("Firebase token refresh failed before receiving an HTTP response.");
    return false;
  }

  Serial.print("Firebase refresh HTTP status: ");
  Serial.println(statusCode);

  if (statusCode < 200 || statusCode >= 300) {
    Serial.println(responseBody);
    return false;
  }

  JsonDocument responseDoc;
  const DeserializationError jsonError = deserializeJson(responseDoc, responseBody);

  if (jsonError) {
    Serial.print("Failed to parse Firebase refresh response JSON: ");
    Serial.println(jsonError.c_str());
    return false;
  }

  firebaseIdToken = String((const char *)(responseDoc["id_token"] | ""));
  firebaseRefreshToken = String((const char *)(responseDoc["refresh_token"] | ""));
  const unsigned long expiresInSeconds =
    String((const char *)(responseDoc["expires_in"] | "3600")).toInt();

  if (firebaseIdToken.isEmpty()) {
    Serial.println("Firebase refresh response is missing an ID token.");
    return false;
  }

  firebaseIdTokenExpiresAtMs = millis() + (expiresInSeconds * 1000UL);
  Serial.println("Firebase ID token refreshed.");
  return true;
}

bool ensureFirebaseReady() {
  if (!firebaseReady) {
    return false;
  }

  const unsigned long nowMs = millis();
  if (firebaseIdTokenExpiresAtMs > nowMs + 60000UL) {
    return true;
  }

  Serial.println("Firebase ID token expiring soon. Refreshing...");
  return refreshFirebaseIdToken();
}

String buildTelemetryPayload() {
  JsonDocument payloadDoc;

  const float temperatureC = 22.0f + ((millis() / 1000UL) % 15) * 0.3f;
  const float humidityPct = 48.0f + ((millis() / 1000UL) % 10) * 1.1f;
  const float batteryVolts = 3.90f - (((millis() / 1000UL) % 20) * 0.01f);

  payloadDoc["deviceId"] = provisionedDeviceId;
  payloadDoc["firebaseUid"] = firebaseUid;
  payloadDoc["temperatureC"] = temperatureC;
  payloadDoc["humidityPct"] = humidityPct;
  payloadDoc["batteryVolts"] = batteryVolts;
  payloadDoc["uptimeMs"] = millis();
  payloadDoc["status"] = "online";
  payloadDoc["updatedAtMs"] = millis();

  String payload;
  serializeJson(payloadDoc, payload);
  return payload;
}

bool writeTelemetry() {
  if (!ensureFirebaseReady()) {
    return false;
  }

  const String path =
    String(FIREBASE_DATABASE_URL) +
    "/devices/" +
    provisionedDeviceId +
    "/latest.json?auth=" +
    firebaseIdToken;

  const String payload = buildTelemetryPayload();
  int statusCode = -1;
  String responseBody;

  if (!putJson(path, payload, statusCode, responseBody)) {
    Serial.println("Telemetry write failed before receiving an HTTP response.");
    return false;
  }

  Serial.print("Telemetry write HTTP status: ");
  Serial.println(statusCode);
  Serial.println("Telemetry write response:");
  Serial.println(responseBody);

  if (statusCode == 401 || statusCode == 403) {
    Serial.println("Firebase rejected the token. Attempting refresh...");
    if (refreshFirebaseIdToken()) {
      return writeTelemetry();
    }
  }

  return statusCode >= 200 && statusCode < 300;
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  Serial.println();
  Serial.println("Arduino Nano ESP32 provisioning and Firebase telemetry test");

  connectToWifi();

  if (!provisionDevice()) {
    Serial.println("Provisioning never succeeded. Halting setup.");
    return;
  }

  if (!signInToFirebaseWithCustomToken()) {
    Serial.println("Firebase sign-in failed. Halting setup.");
    return;
  }

  Serial.println("Device is ready to send telemetry.");
}

void loop() {
  ensureWifiConnected();

  if (!firebaseReady) {
    delay(2000);
    return;
  }

  const unsigned long nowMs = millis();
  if (nowMs - lastTelemetryWriteMs < TELEMETRY_INTERVAL_MS) {
    delay(250);
    return;
  }

  lastTelemetryWriteMs = nowMs;

  if (writeTelemetry()) {
    Serial.println("Telemetry write succeeded.");
  } else {
    Serial.println("Telemetry write failed.");
  }
}
