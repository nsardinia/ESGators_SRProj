/**
 * Device configuration portal. Allows the user to set configuration parameters
 * from the device itself without modifying code. Keeps secure
 * information out of repositories.
 * 
 * Last edit, Nicholas Sardinia, 4/20/2026
 */
#include "device_config.h"

#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>

#include <cstring>

namespace srproj {

namespace {

static const char* kPrefsNamespace = "sr_cfg";
static const char* kApPassword = "";
static const uint32_t kRestartDelayMs = 1800;

Preferences g_prefs;
WebServer g_server(80);
DeviceConfigDefaults g_defaults = {};
DeviceConfigState g_config = {};
bool g_portalStarted = false;
bool g_restartPending = false;
uint32_t g_restartAtMs = 0;


// Safe c-string copy
void copyText(char* dst, size_t dstLen, const char* src) {
  if (dstLen == 0) return;
  if (src == nullptr) {
    dst[0] = '\0';
    return;
  }
  strncpy(dst, src, dstLen - 1);
  dst[dstLen - 1] = '\0';
}

// Load default values (from compiled values) to the configuration.
void loadDefaults() {
  copyText(g_config.wifiSsid, sizeof(g_config.wifiSsid), g_defaults.wifiSsid);
  copyText(g_config.wifiPassword, sizeof(g_config.wifiPassword), g_defaults.wifiPassword);
  copyText(g_config.backendBaseUrl, sizeof(g_config.backendBaseUrl), g_defaults.backendBaseUrl);
  copyText(g_config.deviceId, sizeof(g_config.deviceId), g_defaults.deviceId);
  copyText(g_config.deviceSecret, sizeof(g_config.deviceSecret), g_defaults.deviceSecret);
  copyText(g_config.firebaseApiKey, sizeof(g_config.firebaseApiKey), g_defaults.firebaseApiKey);
  copyText(g_config.firebaseDatabaseUrl, sizeof(g_config.firebaseDatabaseUrl), g_defaults.firebaseDatabaseUrl);
  g_config.nodeId = g_defaults.nodeId == 0 ? 1 : g_defaults.nodeId;
}

void readStringIfPresent(const char* key, char* dst, size_t dstLen) {
  if (!g_prefs.isKey(key)) return;
  String value = g_prefs.getString(key, "");
  copyText(dst, dstLen, value.c_str());
}

// Load values from nv key-value store (preferences) to configuration
void loadStoredOverrides() {
  loadDefaults();
  readStringIfPresent("wifi_ssid", g_config.wifiSsid, sizeof(g_config.wifiSsid));
  readStringIfPresent("wifi_pass", g_config.wifiPassword, sizeof(g_config.wifiPassword));
  readStringIfPresent("backend_url", g_config.backendBaseUrl, sizeof(g_config.backendBaseUrl));
  readStringIfPresent("device_id", g_config.deviceId, sizeof(g_config.deviceId));
  readStringIfPresent("device_sec", g_config.deviceSecret, sizeof(g_config.deviceSecret));
  readStringIfPresent("fb_api_key", g_config.firebaseApiKey, sizeof(g_config.firebaseApiKey));
  readStringIfPresent("fb_db_url", g_config.firebaseDatabaseUrl, sizeof(g_config.firebaseDatabaseUrl));
  if (g_prefs.isKey("node_id")) {
    const uint8_t storedNodeId = g_prefs.getUChar("node_id", g_defaults.nodeId);
    g_config.nodeId = storedNodeId == 0 ? g_defaults.nodeId : storedNodeId;
  }
}

// Helper for HTML escape characters
String htmlEscape(const char* input) {
  String out;
  if (input == nullptr) return out;
  while (*input != '\0') {
    switch (*input) {
      case '&': out += "&amp;"; break;
      case '<': out += "&lt;"; break;
      case '>': out += "&gt;"; break;
      case '"': out += "&quot;"; break;
      case '\'': out += "&#39;"; break;
      default: out += *input; break;
    }
    ++input;
  }
  return out;
}

String apName() {
  return String("SRProj-Setup-Node-") + String(static_cast<unsigned int>(g_config.nodeId));
}

//Setup wifi access point
void restartAccessPoint() {
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPdisconnect(true);
  delay(100);
  WiFi.softAP(apName().c_str(), kApPassword);
}

//Render HTML configuration page.
String renderPage(const char* notice, bool success) {
  const String state = WiFi.status() == WL_CONNECTED ? "Connected" : "Not connected";
  const String stationIp = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("not assigned");
  const String apIp = WiFi.softAPIP().toString();
  String html;
  html.reserve(6000);
  html += F(
    "<!doctype html><html><head><meta charset='utf-8'>"
    "<meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>SRProj Setup</title><style>"
    ":root{color-scheme:light;font-family:Arial,sans-serif;}"
    "body{margin:0;background:#f3f5f8;color:#1f2937;}"
    ".wrap{max-width:760px;margin:0 auto;padding:24px;}"
    ".card{background:#fff;border:1px solid #d9e2ec;border-radius:16px;padding:22px;box-shadow:0 12px 30px rgba(15,23,42,.08);}"
    "h1{margin:0 0 10px;font-size:28px;}p{line-height:1.5;}"
    ".meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:18px 0 20px;}"
    ".pill{background:#eef4ff;border:1px solid #c9d8ff;border-radius:12px;padding:12px;}"
    ".msg{padding:12px 14px;border-radius:12px;margin:0 0 18px;font-weight:600;}"
    ".ok{background:#e8fff1;border:1px solid #98ddb1;color:#116530;}"
    ".info{background:#fff7df;border:1px solid #ead18a;color:#7a5814;}"
    ".grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;}"
    "label{display:block;font-size:13px;font-weight:700;margin-bottom:6px;}"
    "input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:10px;font-size:15px;}"
    "input:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12);}"
    ".full{grid-column:1/-1;}"
    ".actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:18px;}"
    "button{border:0;border-radius:10px;padding:12px 18px;font-size:15px;font-weight:700;cursor:pointer;}"
    ".primary{background:#1d4ed8;color:#fff;}.secondary{background:#e5e7eb;color:#111827;}"
    ".hint{font-size:13px;color:#475569;margin-top:14px;}"
    "</style></head><body><div class='wrap'><div class='card'>"
  );
  html += F("<h1>Node Setup</h1><p>Use this page to override Wi-Fi and provisioning settings. If nothing is saved, the firmware keeps the defaults already compiled into the device.</p>");
  if (notice != nullptr && notice[0] != '\0') {
    html += String("<div class='msg ") + (success ? "ok'>" : "info'>") + htmlEscape(notice) + "</div>";
  }
  html += F("<div class='meta'>");
  html += String("<div class='pill'><strong>Portal SSID</strong><br>") + htmlEscape(apName().c_str()) + "</div>";
  html += String("<div class='pill'><strong>Portal IP</strong><br>") + htmlEscape(apIp.c_str()) + "</div>";
  html += String("<div class='pill'><strong>Wi-Fi State</strong><br>") + htmlEscape(state.c_str()) + "</div>";
  html += String("<div class='pill'><strong>Station IP</strong><br>") + htmlEscape(stationIp.c_str()) + "</div>";
  html += F("</div>");
  html += F("<form method='post' action='/save'><div class='grid'>");
  html += String("<div><label for='wifiSsid'>Wi-Fi Network Name</label><input id='wifiSsid' name='wifiSsid' value='") + htmlEscape(g_config.wifiSsid) + "'></div>";
  html += String("<div><label for='wifiPassword'>Wi-Fi Password</label><input id='wifiPassword' name='wifiPassword' type='password' value='") + htmlEscape(g_config.wifiPassword) + "'></div>";
  html += String("<div><label for='nodeId'>Node ID</label><input id='nodeId' name='nodeId' type='number' min='1' max='255' value='") + String(static_cast<unsigned int>(g_config.nodeId)) + "'></div>";
  html += String("<div><label for='deviceId'>Provisioning Device ID</label><input id='deviceId' name='deviceId' value='") + htmlEscape(g_config.deviceId) + "'></div>";
  html += String("<div class='full'><label for='deviceSecret'>Node Secret</label><input id='deviceSecret' name='deviceSecret' value='") + htmlEscape(g_config.deviceSecret) + "'></div>";
  html += String("<div class='full'><label for='backendBaseUrl'>Backend Base URL</label><input id='backendBaseUrl' name='backendBaseUrl' value='") + htmlEscape(g_config.backendBaseUrl) + "'></div>";
  html += String("<div class='full'><label for='firebaseApiKey'>Firebase API Key</label><input id='firebaseApiKey' name='firebaseApiKey' value='") + htmlEscape(g_config.firebaseApiKey) + "'></div>";
  html += String("<div class='full'><label for='firebaseDatabaseUrl'>Firebase Database URL</label><input id='firebaseDatabaseUrl' name='firebaseDatabaseUrl' value='") + htmlEscape(g_config.firebaseDatabaseUrl) + "'></div>";
  html += F("</div><div class='actions'><button class='primary' type='submit'>Save And Reboot</button></div></form>"
            "<div class='actions'><form method='post' action='/reset'><button class='secondary' type='submit'>Clear Saved Overrides</button></form></div>"
            "<p class='hint'>After saving, the device reboots and uses the new values immediately. The setup access point stays available at boot so you can make changes from a phone or laptop.</p>");
  html += F("</div></div></body></html>");
  return html;
}

void scheduleRestart() {
  g_restartPending = true;
  g_restartAtMs = millis() + kRestartDelayMs;
}

void handleRoot() {
  g_server.send(200, "text/html", renderPage("", false));
}

void handleSave() {
  const int parsedNodeId = g_server.arg("nodeId").toInt();
  if (parsedNodeId <= 0 || parsedNodeId > 255) {
    g_server.send(400, "text/html", renderPage("Node ID must be between 1 and 255.", false));
    return;
  }

  g_prefs.putString("wifi_ssid", g_server.arg("wifiSsid"));
  g_prefs.putString("wifi_pass", g_server.arg("wifiPassword"));
  g_prefs.putString("backend_url", g_server.arg("backendBaseUrl"));
  g_prefs.putString("device_id", g_server.arg("deviceId"));
  g_prefs.putString("device_sec", g_server.arg("deviceSecret"));
  g_prefs.putString("fb_api_key", g_server.arg("firebaseApiKey"));
  g_prefs.putString("fb_db_url", g_server.arg("firebaseDatabaseUrl"));
  g_prefs.putUChar("node_id", static_cast<uint8_t>(parsedNodeId));

  loadStoredOverrides();
  restartAccessPoint();
  g_server.send(200, "text/html", renderPage("Settings saved. Rebooting now.", true));
  scheduleRestart();
}

void handleReset() {
  g_prefs.clear();
  loadStoredOverrides();
  restartAccessPoint();
  g_server.send(200, "text/html", renderPage("Saved overrides cleared. Rebooting with compiled defaults.", true));
  scheduleRestart();
}

void handleNotFound() {
  g_server.sendHeader("Location", "/", true);
  g_server.send(302, "text/plain", "");
}

//Spin up the HTML portal.
void startPortal() {
  if (g_portalStarted) return;

  restartAccessPoint();
  g_server.on("/", HTTP_GET, handleRoot);
  g_server.on("/save", HTTP_POST, handleSave);
  g_server.on("/reset", HTTP_POST, handleReset);
  g_server.onNotFound(handleNotFound);
  g_server.begin();
  g_portalStarted = true;

  Serial.printf(
    "Config portal ready: SSID=%s AP=%s\n",
    apName().c_str(),
    WiFi.softAPIP().toString().c_str()
  );
}

}  // namespace

void initDeviceConfigPortal(const DeviceConfigDefaults& defaults) {
  g_defaults = defaults;
  g_prefs.begin(kPrefsNamespace, false);
  loadStoredOverrides();
  startPortal();
}

void serviceDeviceConfigPortal() {
  if (!g_portalStarted) return;
  g_server.handleClient();
  if (g_restartPending && static_cast<int32_t>(millis() - g_restartAtMs) >= 0) {
    delay(100);
    ESP.restart();
  }
}

//Getters for config and id
const DeviceConfigState& getDeviceConfig() {
  return g_config;
}

uint8_t getConfiguredNodeId() {
  return g_config.nodeId;
}

}  // namespace srproj
