#include "app.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LoRaMesher.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include <cstring>

#include "device_config.h"
#include "node_role.h"
#include "radio_protocol.h"

namespace srproj {

#ifndef SR_NODE_ID
#define SR_NODE_ID 1
#endif

#ifndef SR_GATEWAY_NODE_ID
#define SR_GATEWAY_NODE_ID 3
#endif

#ifndef SR_START_AS_GATEWAY
#define SR_START_AS_GATEWAY 0
#endif

#ifndef SR_DEFAULT_DEVICE_ID
#define SR_DEFAULT_DEVICE_ID "dev_replace_me"
#endif

#ifndef SR_DEFAULT_DEVICE_SECRET
#define SR_DEFAULT_DEVICE_SECRET "replace-with-device-secret"
#endif

static const uint8_t DEFAULT_GATEWAY_NODE_ID = SR_GATEWAY_NODE_ID;

static const uint8_t LORA_SS = 21;
static const uint8_t LORA_RST = 18;
static const uint8_t LORA_DIO0 = 5;

static const uint32_t GATEWAY_SEND_INTERVAL_MS = 4700;
static const uint32_t CLIENT_SEND_INTERVAL_MS = 1000;
static const uint32_t CONFIG_SYNC_INTERVAL_MS = 8000;
static const uint32_t CONFIG_SYNC_FRAME_GAP_MS = 120;
static const uint32_t CLOUD_CONFIG_REFRESH_MS = 15000;
static const uint32_t WIFI_RETRY_MS = 10000;
static const uint32_t UPLOAD_RETRY_MS = 2000;
static const uint32_t HTTP_CONNECT_TIMEOUT_MS = 15000;
static const uint32_t HTTP_TIMEOUT_MS = 20000;
static const size_t FIREBASE_QUEUE_LEN = 24;
static const uint32_t MESH_STATUS_PUBLISH_INTERVAL_MS = 3000;
static const uint32_t NODE_STALE_TIMEOUT_MS = 15000;
static const uint32_t FIREBASE_TASK_STACK_BYTES = 16384;

static const char* NETWORK_ENV_FALLBACK_JSON = R"json(
{
  "version": 1,
  "gateways": [3],
  "nodes": [
    { "nodeId": 1, "role": "client",  "preferredGateway": 3, "fallbackGateway": 0, "enabled": true },
    { "nodeId": 2, "role": "client",  "preferredGateway": 3, "fallbackGateway": 0, "enabled": true },
    { "nodeId": 3, "role": "gateway", "preferredGateway": 3, "fallbackGateway": 0, "enabled": true }
  ]
}
)json";

static const char* DEFAULT_WIFI_SSID = "YOUR_WIFI_SSID";
static const char* DEFAULT_WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
static const char* DEFAULT_BACKEND_BASE_URL = "https://your-backend-host";
static const char* DEFAULT_DEVICE_ID = SR_DEFAULT_DEVICE_ID;
static const char* DEFAULT_DEVICE_SECRET = SR_DEFAULT_DEVICE_SECRET;
static const char* DEFAULT_FIREBASE_API_KEY = "your-firebase-web-api-key";
static const char* DEFAULT_FIREBASE_DATABASE_URL = "https://your-project-default-rtdb.firebaseio.com";
static const bool ALLOW_INSECURE_TLS = true;

struct NodeAddressEntry {
  uint8_t nodeId;
  uint16_t address;
};

struct RouteSnapshot {
  bool found;
  uint16_t address;
  uint16_t viaAddr;
  uint8_t hops;
  uint8_t roleFlags;
};

LoraMesher& radio = LoraMesher::getInstance();
TaskHandle_t receiveTaskHandle = nullptr;
TaskHandle_t firebaseTaskHandle = nullptr;
QueueHandle_t firebaseQueue = nullptr;

static uint32_t txCounter = 0;
static uint32_t lastSendMs = 0;
static uint32_t lastConfigSyncMs = 0;
static uint16_t localAddr = 0;
static String serialLine;
static char localDeviceId[MAX_DEVICE_ID_LEN] = {0};

static NetworkConfigState desiredConfig = {};
static uint8_t preferredGatewayNodeId = DEFAULT_GATEWAY_NODE_ID;
static uint8_t fallbackGatewayNodeId = 0;
static char preferredGatewayDeviceId[MAX_DEVICE_ID_LEN] = {0};
static char fallbackGatewayDeviceId[MAX_DEVICE_ID_LEN] = {0};
static bool radioConfigLoaded = false;
static bool localDeviceInRadioNetwork = false;
static uint32_t lastCloudConfigFetchMs = 0;

static NodeAddressEntry nodeAddressTable[MAX_NETWORK_NODES];
static size_t nodeAddressCount = 0;
static bool firebaseReady = false;
static bool provisioned = false;
static uint32_t firebaseIdTokenExpiresAtMs = 0;
static uint32_t lastWifiAttemptMs = 0;
static String provisionedDeviceId;
static String firebaseCustomToken;
static String firebaseUid;
static String firebaseIdToken;
static String firebaseRefreshToken;
static uint32_t firebaseQueuedEvents = 0;
static uint32_t firebaseUploadedEvents = 0;
static uint32_t firebaseFailedEvents = 0;
static uint32_t lastFirebaseDiagMs = 0;
static uint32_t lastMeshStatusPublishMs = 0;

void copyDeviceId(char* dst, size_t dstLen, const char* src) {
  if (dstLen == 0) return;
  if (src == nullptr) {
    dst[0] = '\0';
    return;
  }
  strncpy(dst, src, dstLen - 1);
  dst[dstLen - 1] = '\0';
}

bool textEquals(const char* lhs, const char* rhs) {
  if (lhs == nullptr || rhs == nullptr) return false;
  return strcmp(lhs, rhs) == 0;
}

bool textHasValue(const char* value) {
  return value != nullptr && value[0] != '\0';
}

uint8_t thisNodeId() {
  return getConfiguredNodeId();
}

const char* meshRoleName(MeshNodeRole role) {
  return role == MeshNodeRole::Gateway ? "gateway" : "client";
}

bool parseMeshRole(const String& roleString, MeshNodeRole& roleOut) {
  String roleLower = roleString;
  roleLower.toLowerCase();
  if (roleLower == "gateway") {
    roleOut = MeshNodeRole::Gateway;
    return true;
  }
  if (roleLower == "client") {
    roleOut = MeshNodeRole::Client;
    return true;
  }
  return false;
}

const char* routeRoleName(uint8_t roleFlags) {
  return (roleFlags & 0x01U) != 0U ? "gateway" : "client";
}

void syncLoRaRoleFlag() {
  if (getNodeRole() == NodeRole::Gateway) {
    LoraMesher::addGatewayRole();
  } else {
    LoraMesher::removeGatewayRole();
  }
}

void makeLocalDeviceId() {
  if (textHasValue(getDeviceConfig().deviceId)) {
    copyDeviceId(localDeviceId, sizeof(localDeviceId), getDeviceConfig().deviceId);
    return;
  }
  snprintf(localDeviceId, sizeof(localDeviceId), "mesh_node_%u", static_cast<unsigned int>(thisNodeId()));
}

void clearNetworkConfig(NetworkConfigState& cfg) {
  cfg.version = 0;
  cfg.nodeCount = 0;
  cfg.gatewayCount = 0;
  memset(cfg.nodes, 0, sizeof(cfg.nodes));
  memset(cfg.gateways, 0, sizeof(cfg.gateways));
}

int findNodeConfigIndex(const NetworkConfigState& cfg, uint8_t nodeId) {
  for (size_t i = 0; i < cfg.nodeCount; ++i) {
    if (cfg.nodes[i].nodeId == nodeId) return static_cast<int>(i);
  }
  return -1;
}

int findNodeConfigIndexByDeviceId(const NetworkConfigState& cfg, const char* deviceId) {
  if (!textHasValue(deviceId)) return -1;
  for (size_t i = 0; i < cfg.nodeCount; ++i) {
    if (textEquals(cfg.nodes[i].deviceId, deviceId)) return static_cast<int>(i);
  }
  return -1;
}

void ensureGatewayListed(NetworkConfigState& cfg, const char* gatewayDeviceId) {
  if (!textHasValue(gatewayDeviceId)) return;
  for (size_t i = 0; i < cfg.gatewayCount; ++i) {
    if (textEquals(cfg.gateways[i], gatewayDeviceId)) return;
  }
  if (cfg.gatewayCount >= MAX_GATEWAYS) return;
  copyDeviceId(cfg.gateways[cfg.gatewayCount], sizeof(cfg.gateways[cfg.gatewayCount]), gatewayDeviceId);
  cfg.gatewayCount += 1;
}

void upsertNodeConfig(
  NetworkConfigState& cfg,
  const char* deviceId,
  uint8_t nodeId,
  MeshNodeRole role,
  const char* preferredGatewayDevice,
  uint8_t preferredGatewayNode,
  const char* fallbackGatewayDevice,
  uint8_t fallbackGatewayNode,
  bool enabled
) {
  int idx = findNodeConfigIndexByDeviceId(cfg, deviceId);
  if (idx < 0 && nodeId != 0) idx = findNodeConfigIndex(cfg, nodeId);
  if (idx < 0) {
    if (cfg.nodeCount >= MAX_NETWORK_NODES) return;
    idx = static_cast<int>(cfg.nodeCount++);
  }
  copyDeviceId(cfg.nodes[idx].deviceId, sizeof(cfg.nodes[idx].deviceId), deviceId);
  cfg.nodes[idx].nodeId = nodeId;
  cfg.nodes[idx].role = role;
  cfg.nodes[idx].preferredGatewayId = preferredGatewayNode;
  cfg.nodes[idx].fallbackGatewayId = fallbackGatewayNode;
  copyDeviceId(cfg.nodes[idx].preferredGatewayDeviceId, sizeof(cfg.nodes[idx].preferredGatewayDeviceId), preferredGatewayDevice);
  copyDeviceId(cfg.nodes[idx].fallbackGatewayDeviceId, sizeof(cfg.nodes[idx].fallbackGatewayDeviceId), fallbackGatewayDevice);
  cfg.nodes[idx].enabled = enabled;
  if (role == MeshNodeRole::Gateway) {
    ensureGatewayListed(cfg, textHasValue(deviceId) ? deviceId : preferredGatewayDevice);
  }
}

const NodeConfigEntry* getLocalNodeConfigEntry() {
  for (size_t i = 0; i < desiredConfig.nodeCount; ++i) {
    const NodeConfigEntry& entry = desiredConfig.nodes[i];
    if (!entry.enabled) continue;
    if (textHasValue(entry.deviceId) && textEquals(entry.deviceId, localDeviceId)) return &entry;
    if (entry.nodeId != 0 && entry.nodeId == thisNodeId()) return &entry;
  }
  return nullptr;
}

void applyLocalNodeConfig(const char* source) {
  const NodeConfigEntry* localCfg = getLocalNodeConfigEntry();
  if (localCfg == nullptr) {
    localDeviceInRadioNetwork = false;
    preferredGatewayNodeId = 0;
    fallbackGatewayNodeId = 0;
    preferredGatewayDeviceId[0] = '\0';
    fallbackGatewayDeviceId[0] = '\0';
    requestNodeRole(NodeRole::Client, source);
    applyPendingNodeRole();
    syncLoRaRoleFlag();
    makeLocalDeviceId();
    return;
  }

  localDeviceInRadioNetwork = true;
  preferredGatewayNodeId = localCfg->preferredGatewayId;
  fallbackGatewayNodeId = localCfg->fallbackGatewayId;
  copyDeviceId(preferredGatewayDeviceId, sizeof(preferredGatewayDeviceId), localCfg->preferredGatewayDeviceId);
  copyDeviceId(fallbackGatewayDeviceId, sizeof(fallbackGatewayDeviceId), localCfg->fallbackGatewayDeviceId);

  requestNodeRole(localCfg->role == MeshNodeRole::Gateway ? NodeRole::Gateway : NodeRole::Client, source);
  applyPendingNodeRole();
  syncLoRaRoleFlag();
  makeLocalDeviceId();
}

bool parseNetworkConfigJson(const String& json, NetworkConfigState& outCfg) {
  DynamicJsonDocument doc(8192);
  DeserializationError err = deserializeJson(doc, json);
  if (err) return false;

  NetworkConfigState parsed = {};
  clearNetworkConfig(parsed);
  parsed.version = doc["version"] | 1;

  JsonArray gateways = doc["gateways"].as<JsonArray>();
  if (!gateways.isNull()) {
    for (JsonVariant gateway : gateways) ensureGatewayListed(parsed, gateway.as<const char*>());
  }

  JsonArray nodes = doc["nodes"].as<JsonArray>();
  if (nodes.isNull()) return false;

  for (JsonVariant nodeVar : nodes) {
    char deviceIdBuf[MAX_DEVICE_ID_LEN] = {0};
    char preferredGatewayDeviceBuf[MAX_DEVICE_ID_LEN] = {0};
    char fallbackGatewayDeviceBuf[MAX_DEVICE_ID_LEN] = {0};

    uint8_t nodeId = 0;
    if (nodeVar["nodeId"].is<const char*>()) {
      copyDeviceId(deviceIdBuf, sizeof(deviceIdBuf), nodeVar["nodeId"].as<const char*>());
    } else {
      nodeId = nodeVar["nodeId"] | 0;
    }

    if (nodeVar["deviceId"].is<const char*>()) {
      copyDeviceId(deviceIdBuf, sizeof(deviceIdBuf), nodeVar["deviceId"].as<const char*>());
    }
    if (!textHasValue(deviceIdBuf) && nodeId == 0) continue;

    uint8_t preferredGatewayNode = 0;
    if (nodeVar["preferredGateway"].is<const char*>()) {
      copyDeviceId(preferredGatewayDeviceBuf, sizeof(preferredGatewayDeviceBuf), nodeVar["preferredGateway"].as<const char*>());
    } else {
      preferredGatewayNode = nodeVar["preferredGateway"] | 0;
    }

    uint8_t fallbackGatewayNode = 0;
    if (nodeVar["fallbackGateway"].is<const char*>()) {
      copyDeviceId(fallbackGatewayDeviceBuf, sizeof(fallbackGatewayDeviceBuf), nodeVar["fallbackGateway"].as<const char*>());
    } else {
      fallbackGatewayNode = nodeVar["fallbackGateway"] | 0;
    }

    MeshNodeRole role = MeshNodeRole::Client;
    parseMeshRole(String((const char*)(nodeVar["role"] | "client")), role);
    upsertNodeConfig(
      parsed,
      deviceIdBuf,
      nodeId,
      role,
      preferredGatewayDeviceBuf,
      preferredGatewayNode,
      fallbackGatewayDeviceBuf,
      fallbackGatewayNode,
      nodeVar["enabled"].isNull() ? true : nodeVar["enabled"].as<bool>()
    );
  }

  outCfg = parsed;
  return true;
}

bool loadNetworkConfigFromEnvJson() {
  String json = String(NETWORK_ENV_FALLBACK_JSON);
  Serial.println("Using in-memory network config JSON (SPIFFS disabled)");

  NetworkConfigState parsed = {};
  if (!parseNetworkConfigJson(json, parsed)) return false;
  desiredConfig = parsed;
  applyLocalNodeConfig("env_json");
  radioConfigLoaded = true;
  return true;
}

void dumpDesiredConfig() {
  Serial.printf("Desired config v%u nodes=%u gateways=%u\n",
                static_cast<unsigned int>(desiredConfig.version),
                static_cast<unsigned int>(desiredConfig.nodeCount),
                static_cast<unsigned int>(desiredConfig.gatewayCount));
  for (size_t i = 0; i < desiredConfig.nodeCount; ++i) {
    const NodeConfigEntry& n = desiredConfig.nodes[i];
    Serial.printf("  node=%u device=%s role=%s prefGw=%u prefDev=%s fbGw=%u fbDev=%s enabled=%u seen=%lu addr=0x%X\n",
                  static_cast<unsigned int>(n.nodeId),
                  n.deviceId,
                  meshRoleName(n.role),
                  static_cast<unsigned int>(n.preferredGatewayId),
                  n.preferredGatewayDeviceId,
                  static_cast<unsigned int>(n.fallbackGatewayId),
                  n.fallbackGatewayDeviceId,
                  n.enabled ? 1U : 0U,
                  static_cast<unsigned long>(n.lastSeenMs),
                  n.lastKnownAddress);
  }
}

void upsertNodeAddress(uint8_t nodeId, uint16_t address) {
  if (nodeId == 0 || address == 0) return;
  for (size_t i = 0; i < nodeAddressCount; ++i) {
    if (nodeAddressTable[i].nodeId == nodeId) {
      nodeAddressTable[i].address = address;
      return;
    }
  }
  if (nodeAddressCount >= MAX_NETWORK_NODES) return;
  nodeAddressTable[nodeAddressCount].nodeId = nodeId;
  nodeAddressTable[nodeAddressCount].address = address;
  nodeAddressCount += 1;
}

bool lookupAddressByNodeId(uint8_t nodeId, uint16_t& out) {
  for (size_t i = 0; i < nodeAddressCount; ++i) {
    if (nodeAddressTable[i].nodeId == nodeId) {
      out = nodeAddressTable[i].address;
      return true;
    }
  }
  return false;
}

bool lookupNodeIdByAddress(uint16_t address, uint8_t& outNodeId) {
  for (size_t i = 0; i < nodeAddressCount; ++i) {
    if (nodeAddressTable[i].address == address) {
      outNodeId = nodeAddressTable[i].nodeId;
      return true;
    }
  }
  return false;
}

NodeConfigEntry* findMutableNodeConfigByDeviceId(const char* deviceId) {
  const int idx = findNodeConfigIndexByDeviceId(desiredConfig, deviceId);
  if (idx < 0) return nullptr;
  return &desiredConfig.nodes[idx];
}

NodeConfigEntry* findMutableNodeConfigByNodeId(uint8_t nodeId) {
  const int idx = findNodeConfigIndex(desiredConfig, nodeId);
  if (idx < 0) return nullptr;
  return &desiredConfig.nodes[idx];
}

const NodeConfigEntry* findNodeConfigByNodeId(uint8_t nodeId) {
  const int idx = findNodeConfigIndex(desiredConfig, nodeId);
  if (idx < 0) return nullptr;
  return &desiredConfig.nodes[idx];
}

const NodeConfigEntry* findNodeConfigByDeviceId(const char* deviceId) {
  const int idx = findNodeConfigIndexByDeviceId(desiredConfig, deviceId);
  if (idx < 0) return nullptr;
  return &desiredConfig.nodes[idx];
}

void noteNodeSeen(const char* deviceId, uint8_t nodeId, uint16_t address, uint32_t now) {
  NodeConfigEntry* entry = nullptr;
  if (textHasValue(deviceId)) entry = findMutableNodeConfigByDeviceId(deviceId);
  if (entry == nullptr && nodeId != 0) entry = findMutableNodeConfigByNodeId(nodeId);
  if (entry == nullptr) return;

  if (nodeId != 0) entry->nodeId = nodeId;
  if (address != 0) entry->lastKnownAddress = address;
  entry->lastSeenMs = now;
}

bool hasRecentNodeContact(const NodeConfigEntry& entry, uint32_t now) {
  if (!entry.enabled) return false;
  if (textHasValue(entry.deviceId) && textEquals(entry.deviceId, localDeviceId)) return true;
  if (entry.lastSeenMs == 0) return false;
  return now - entry.lastSeenMs <= NODE_STALE_TIMEOUT_MS;
}

bool resolveGatewayAddress(const char* gatewayDeviceId, uint8_t gatewayNodeId, uint16_t& outAddr) {
  if (textHasValue(gatewayDeviceId)) {
    const NodeConfigEntry* gatewayCfg = findNodeConfigByDeviceId(gatewayDeviceId);
    if (gatewayCfg != nullptr) {
      if (gatewayCfg->lastKnownAddress != 0) {
        outAddr = gatewayCfg->lastKnownAddress;
        return true;
      }
      if (gatewayCfg->nodeId != 0 && lookupAddressByNodeId(gatewayCfg->nodeId, outAddr)) return true;
    }
  }

  if (gatewayNodeId != 0 && lookupAddressByNodeId(gatewayNodeId, outAddr)) return true;
  return false;
}

RouteSnapshot findRouteSnapshotByAddress(uint16_t address) {
  RouteSnapshot snapshot = {};
  if (address == 0) return snapshot;

  LM_LinkedList<RouteNode>* routes = radio.routingTableListCopy();
  if (routes == nullptr) return snapshot;

  if (routes->moveToStart()) {
    do {
      RouteNode* route = routes->getCurrent();
      if (route == nullptr) continue;
      if (route->networkNode.address != address) continue;
      snapshot.found = true;
      snapshot.address = route->networkNode.address;
      snapshot.viaAddr = route->via;
      snapshot.hops = route->networkNode.metric;
      snapshot.roleFlags = route->networkNode.role;
      break;
    } while (routes->next());
  }

  delete routes;
  return snapshot;
}

void appendMeshNodeStatus(
  JsonArray& nodes,
  const char* deviceId,
  uint8_t nodeId,
  uint16_t address,
  const char* status,
  const char* role,
  uint8_t hops,
  uint16_t viaAddr,
  uint8_t viaNodeId
) {
  JsonObject node = nodes.add<JsonObject>();
  if (textHasValue(deviceId)) node["deviceId"] = deviceId;
  if (nodeId != 0) node["nodeId"] = nodeId;
  node["address"] = address;
  node["status"] = status;
  node["role"] = role;
  node["hops"] = hops;
  node["viaAddr"] = viaAddr;
  if (viaNodeId != 0) node["viaNodeId"] = viaNodeId;
}

bool isHttpsUrl(const String& url) {
  return url.startsWith("https://");
}

void configureHttpClient(HTTPClient& http) {
  http.addHeader("Content-Type", "application/json");
  http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
  http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
}

String urlEncode(const String& input) {
  const char* hex = "0123456789ABCDEF";
  String encoded;
  for (size_t i = 0; i < input.length(); i += 1) {
    const char current = input[i];
    const bool safeChar =
      (current >= 'a' && current <= 'z') ||
      (current >= 'A' && current <= 'Z') ||
      (current >= '0' && current <= '9') ||
      current == '-' || current == '_' || current == '.' || current == '~';
    if (safeChar) {
      encoded += current;
      continue;
    }
    encoded += '%';
    encoded += hex[(current >> 4) & 0x0F];
    encoded += hex[current & 0x0F];
  }
  return encoded;
}

void logFirebaseTaskVitals(const char* stage) {
  UBaseType_t stackWords = 0;
  if (firebaseTaskHandle != nullptr) {
    stackWords = uxTaskGetStackHighWaterMark(firebaseTaskHandle);
  }
  Serial.printf(
    "Firebase dbg stage=%s heap=%u minHeap=%u stackHW=%u\n",
    stage,
    static_cast<unsigned int>(ESP.getFreeHeap()),
    static_cast<unsigned int>(ESP.getMinFreeHeap()),
    static_cast<unsigned int>(stackWords * sizeof(StackType_t))
  );
}

bool postJson(const String& url, const String& payload, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    configureHttpClient(http);
    statusCode = http.POST(payload);
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  configureHttpClient(http);
  statusCode = http.POST(payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool postForm(const String& url, const String& payload, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
    http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
    statusCode = http.POST(payload);
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
  http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
  statusCode = http.POST(payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool putJson(const String& url, const String& payload, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    configureHttpClient(http);
    statusCode = http.sendRequest("PUT", payload);
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  configureHttpClient(http);
  statusCode = http.sendRequest("PUT", payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool getJson(const String& url, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
    http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
    statusCode = http.GET();
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
  http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
  statusCode = http.GET();
  responseBody = http.getString();
  http.end();
  return true;
}

void kickWifiConnect() {
  const uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED || now - lastWifiAttemptMs < WIFI_RETRY_MS) return;
  const DeviceConfigState& cfg = getDeviceConfig();
  if (cfg.wifiSsid[0] == '\0') return;
  lastWifiAttemptMs = now;
  WiFi.disconnect();
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(cfg.wifiSsid, cfg.wifiPassword);
}

bool provisionDevice() {
  const DeviceConfigState& cfg = getDeviceConfig();
  const String endpoint = String(cfg.backendBaseUrl) + "/devices/provision";
  DynamicJsonDocument payloadDoc(256);
  payloadDoc["deviceId"] = cfg.deviceId;
  payloadDoc["deviceSecret"] = cfg.deviceSecret;

  String payload;
  serializeJson(payloadDoc, payload);

  int statusCode = -1;
  String responseBody;
  if (!postJson(endpoint, payload, statusCode, responseBody)) return false;
  if (statusCode < 200 || statusCode >= 300) return false;

  DynamicJsonDocument responseDoc(2048);
  if (deserializeJson(responseDoc, responseBody)) return false;

  firebaseCustomToken = String((const char*)(responseDoc["firebaseCustomToken"] | ""));
  firebaseUid = String((const char*)(responseDoc["firebaseUid"] | ""));
  provisionedDeviceId = String((const char*)(responseDoc["deviceId"] | ""));
  if (firebaseCustomToken.isEmpty() || provisionedDeviceId.isEmpty()) return false;

  provisioned = true;
  return true;
}

bool signInToFirebaseWithCustomToken() {
  const DeviceConfigState& cfg = getDeviceConfig();
  const String endpoint =
    String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=") + cfg.firebaseApiKey;

  DynamicJsonDocument payloadDoc(512);
  payloadDoc["token"] = firebaseCustomToken;
  payloadDoc["returnSecureToken"] = true;

  String payload;
  serializeJson(payloadDoc, payload);

  int statusCode = -1;
  String responseBody;
  if (!postJson(endpoint, payload, statusCode, responseBody)) return false;
  if (statusCode < 200 || statusCode >= 300) return false;

  DynamicJsonDocument responseDoc(3072);
  if (deserializeJson(responseDoc, responseBody)) return false;

  firebaseIdToken = String((const char*)(responseDoc["idToken"] | ""));
  firebaseRefreshToken = String((const char*)(responseDoc["refreshToken"] | ""));
  const uint32_t expiresInSeconds = String((const char*)(responseDoc["expiresIn"] | "3600")).toInt();
  if (firebaseIdToken.isEmpty() || firebaseRefreshToken.isEmpty()) return false;

  firebaseIdTokenExpiresAtMs = millis() + (expiresInSeconds * 1000UL);
  firebaseReady = true;
  return true;
}

bool refreshFirebaseIdToken() {
  if (firebaseRefreshToken.isEmpty()) return false;
  const String endpoint = String("https://securetoken.googleapis.com/v1/token?key=") + getDeviceConfig().firebaseApiKey;
  const String payload = "grant_type=refresh_token&refresh_token=" + urlEncode(firebaseRefreshToken);

  int statusCode = -1;
  String responseBody;
  if (!postForm(endpoint, payload, statusCode, responseBody)) return false;
  if (statusCode < 200 || statusCode >= 300) return false;

  DynamicJsonDocument responseDoc(2048);
  if (deserializeJson(responseDoc, responseBody)) return false;

  firebaseIdToken = String((const char*)(responseDoc["id_token"] | ""));
  firebaseRefreshToken = String((const char*)(responseDoc["refresh_token"] | ""));
  const uint32_t expiresInSeconds = String((const char*)(responseDoc["expires_in"] | "3600")).toInt();
  if (firebaseIdToken.isEmpty()) return false;

  firebaseIdTokenExpiresAtMs = millis() + (expiresInSeconds * 1000UL);
  return true;
}

bool ensureFirebaseReady() {
  if (!firebaseReady) return false;
  const uint32_t now = millis();
  if (firebaseIdTokenExpiresAtMs > now + 60000UL) return true;
  return refreshFirebaseIdToken();
}

bool writeJsonByPath(const String& dbPath, const String& payload) {
  if (!ensureFirebaseReady()) return false;
  const String url = String(getDeviceConfig().firebaseDatabaseUrl) + "/" + dbPath + ".json?auth=" + firebaseIdToken;

  int statusCode = -1;
  String responseBody;
  if (!putJson(url, payload, statusCode, responseBody)) return false;

  if (statusCode == 401) {
    if (refreshFirebaseIdToken()) return writeJsonByPath(dbPath, payload);
    return false;
  }
  return statusCode >= 200 && statusCode < 300;
}

bool readJsonByPath(const String& dbPath, String& responseBody) {
  if (!ensureFirebaseReady()) return false;
  const String url = String(getDeviceConfig().firebaseDatabaseUrl) + "/" + dbPath + ".json?auth=" + firebaseIdToken;

  int statusCode = -1;
  if (!getJson(url, statusCode, responseBody)) return false;

  if (statusCode == 401) {
    if (refreshFirebaseIdToken()) return readJsonByPath(dbPath, responseBody);
    return false;
  }
  return statusCode >= 200 && statusCode < 300;
}

bool refreshRadioNetworkConfigFromCloud(bool force) {
  const uint32_t now = millis();
  if (!force) {
    if (!radioConfigLoaded) {
      // Initial startup should fetch immediately.
    } else if (getNodeRole() != NodeRole::Gateway) {
      return true;
    } else if (now - lastCloudConfigFetchMs < CLOUD_CONFIG_REFRESH_MS) {
      return true;
    }
  }

  String configJson;
  logFirebaseTaskVitals("before_cfg_get");
  if (!readJsonByPath("config/radio-network", configJson)) return false;
  Serial.printf("Firebase dbg config bytes=%u\n", static_cast<unsigned int>(configJson.length()));
  logFirebaseTaskVitals("after_cfg_get");

  NetworkConfigState parsed = {};
  if (!parseNetworkConfigJson(configJson, parsed)) return false;
  logFirebaseTaskVitals("after_cfg_parse");

  desiredConfig = parsed;
  if (const NodeConfigEntry* localCfg = getLocalNodeConfigEntry(); localCfg != nullptr) {
    NodeConfigEntry* mutableLocal = nullptr;
    if (textHasValue(localCfg->deviceId)) {
      mutableLocal = findMutableNodeConfigByDeviceId(localCfg->deviceId);
    }
    if (mutableLocal == nullptr && localCfg->nodeId != 0) {
      mutableLocal = findMutableNodeConfigByNodeId(localCfg->nodeId);
    }
    if (mutableLocal != nullptr) {
      mutableLocal->nodeId = thisNodeId();
      mutableLocal->lastKnownAddress = localAddr;
      mutableLocal->lastSeenMs = now;
    }
  }

  applyLocalNodeConfig("firebase_config");
  radioConfigLoaded = true;
  lastCloudConfigFetchMs = now;
  logFirebaseTaskVitals("after_cfg_apply");
  dumpDesiredConfig();
  return true;
}

bool shouldUseRadioNetwork() {
  return radioConfigLoaded && localDeviceInRadioNetwork;
}

bool shouldUploadDirectToFirebase() {
  return radioConfigLoaded && !localDeviceInRadioNetwork;
}

bool uploadDirectReading(const GatewayReading& msg) {
  DynamicJsonDocument payloadDoc(512);
  payloadDoc["deviceId"] = provisionedDeviceId;
  payloadDoc["nodeId"] = thisNodeId();
  payloadDoc["type"] = "direct";
  payloadDoc["counter"] = msg.counter;
  payloadDoc["uptimeMs"] = msg.uptimeMs;
  payloadDoc["readingRaw"] = msg.readingRaw;
  payloadDoc["eventAtMs"] = msg.eventAtMs;

  String payload;
  serializeJson(payloadDoc, payload);

  const String latestPath = String("devices/") + provisionedDeviceId + "/readings/latest";
  if (!writeJsonByPath(latestPath, payload)) return false;

  const String currentPath = String("devices/") + provisionedDeviceId + "/readings";
  if (!writeJsonByPath(currentPath, payload)) return false;

  const String historyKey = String(msg.eventAtMs) + "_" + String(static_cast<unsigned long>(msg.counter));
  const String historyPath = String("devices/") + provisionedDeviceId + "/readings/history/" + historyKey;
  if (!writeJsonByPath(historyPath, payload)) return false;
  return true;
}

bool uploadReadingEvent(const GatewayReading& msg) {
  if (shouldUploadDirectToFirebase()) return uploadDirectReading(msg);

  DynamicJsonDocument payloadDoc(768);
  payloadDoc["deviceId"] = msg.sourceDeviceId;
  payloadDoc["gatewayDeviceId"] = provisionedDeviceId;
  payloadDoc["firebaseUid"] = firebaseUid;
  payloadDoc["type"] = msg.isTx ? "tx" : "rx";
  payloadDoc["localAddr"] = msg.localAddr;
  payloadDoc["peerAddr"] = msg.peerAddr;
  payloadDoc["nodeId"] = msg.nodeId;
  payloadDoc["counter"] = msg.counter;
  payloadDoc["uptimeMs"] = msg.uptimeMs;
  payloadDoc["readingRaw"] = msg.readingRaw;
  payloadDoc["eventAtMs"] = msg.eventAtMs;

  String payload;
  serializeJson(payloadDoc, payload);

  const String latestPath = String("devices/") + provisionedDeviceId + "/gatewayReadings/latest";
  if (!writeJsonByPath(latestPath, payload)) {
    Serial.println("Firebase: failed writing gatewayReadings/latest");
    return false;
  }

  if (!msg.isTx) {
    String clientKey;
    if (strlen(msg.sourceDeviceId) > 0) {
      clientKey = String(msg.sourceDeviceId);
    } else {
      clientKey = String("node_") + String(msg.nodeId);
    }

    const String clientLatestPath =
      String("devices/") + provisionedDeviceId + "/clients/" + clientKey + "/readings/latest";
    if (!writeJsonByPath(clientLatestPath, payload)) {
      Serial.printf("Firebase: failed writing %s\n", clientLatestPath.c_str());
      return false;
    }

    const String historyKey =
      String(msg.eventAtMs) + "_" + String(static_cast<unsigned long>(msg.counter));
    const String clientHistoryPath =
      String("devices/") + provisionedDeviceId + "/clients/" + clientKey + "/readings/history/" + historyKey;
    if (!writeJsonByPath(clientHistoryPath, payload)) {
      Serial.printf("Firebase: failed writing %s\n", clientHistoryPath.c_str());
      return false;
    }

    // Legacy path kept for backward compatibility with existing dashboards.
    const String legacyClientPath =
      String("devices/") + provisionedDeviceId + "/" + clientKey + "/readings";
    if (!writeJsonByPath(legacyClientPath, payload)) {
      Serial.printf("Firebase: failed writing legacy path %s\n", legacyClientPath.c_str());
      return false;
    }
  }

  return true;
}

bool uploadMeshStatusSnapshot(uint32_t now) {
  if (provisionedDeviceId.isEmpty()) return false;
  if (!shouldUseRadioNetwork() || getNodeRole() != NodeRole::Gateway) return false;

  DynamicJsonDocument payloadDoc(6144);
  payloadDoc["gatewayNodeId"] = thisNodeId();
  payloadDoc["gatewayDeviceId"] = provisionedDeviceId;
  payloadDoc["gatewayAddr"] = localAddr;
  payloadDoc["updatedAtMs"] = now;
  payloadDoc["configVersion"] = desiredConfig.version;
  payloadDoc["routingTableSize"] = radio.routingTableSize();
  payloadDoc["staleTimeoutMs"] = NODE_STALE_TIMEOUT_MS;

  JsonArray nodes = payloadDoc.createNestedArray("nodes");
  JsonArray paths = payloadDoc.createNestedArray("paths");

  for (size_t i = 0; i < desiredConfig.nodeCount; ++i) {
    const NodeConfigEntry& cfg = desiredConfig.nodes[i];
    const bool isLocalDevice = textHasValue(cfg.deviceId) && textEquals(cfg.deviceId, localDeviceId);
    const bool available = isLocalDevice || hasRecentNodeContact(cfg, now);
    const char* status = !cfg.enabled ? "disabled" : (available ? "up" : "down");

    uint16_t address = isLocalDevice ? localAddr : cfg.lastKnownAddress;
    if (address == 0 && cfg.nodeId != 0) lookupAddressByNodeId(cfg.nodeId, address);
    const RouteSnapshot route = findRouteSnapshotByAddress(address);
    uint8_t viaNodeId = 0;
    if (route.found && route.viaAddr != 0) lookupNodeIdByAddress(route.viaAddr, viaNodeId);

    appendMeshNodeStatus(
      nodes,
      cfg.deviceId,
      cfg.nodeId,
      address,
      status,
      meshRoleName(cfg.role),
      route.found ? route.hops : 0,
      route.found ? route.viaAddr : 0,
      viaNodeId
    );

    JsonObject path = paths.add<JsonObject>();
    if (textHasValue(cfg.deviceId)) path["deviceId"] = cfg.deviceId;
    if (cfg.nodeId != 0) path["nodeId"] = cfg.nodeId;
    path["status"] = status;
    path["address"] = address;
    path["role"] = meshRoleName(cfg.role);
    if (route.found) {
      path["viaAddr"] = route.viaAddr;
      path["hops"] = route.hops;
      path["routeRole"] = routeRoleName(route.roleFlags);
      if (viaNodeId != 0) path["viaNodeId"] = viaNodeId;
    }
  }

  String payload;
  serializeJson(payloadDoc, payload);

  const String latestPath = String("devices/") + provisionedDeviceId + "/networkStatus/latest";
  if (!writeJsonByPath(latestPath, payload)) {
    Serial.println("Firebase: failed writing networkStatus/latest");
    return false;
  }

  const String legacyPath = String("devices/") + provisionedDeviceId + "/meshStatus/latest";
  if (!writeJsonByPath(legacyPath, payload)) {
    Serial.println("Firebase: failed writing meshStatus/latest");
    return false;
  }

  return true;
}

void queueFirebaseUploadEvent(bool isTx, uint16_t peerAddr, const MeshPacketPayload& payload, uint32_t eventAtMs) {
  if (firebaseQueue == nullptr) return;
  if (getNodeRole() != NodeRole::Gateway && !shouldUploadDirectToFirebase()) return;

  GatewayReading event = {};
  event.isTx = isTx;
  event.localAddr = localAddr;
  event.peerAddr = peerAddr;
  event.nodeId = payload.nodeId;
  event.counter = payload.counter;
  event.uptimeMs = payload.uptimeMs;
  event.readingRaw = payload.readingRaw;
  event.eventAtMs = eventAtMs;
  event.uploadRetries = 0;
  copyDeviceId(event.sourceDeviceId, sizeof(event.sourceDeviceId), payload.deviceId);
  if (xQueueSend(firebaseQueue, &event, 0) == pdTRUE) {
    firebaseQueuedEvents++;
  } else {
    firebaseFailedEvents++;
    Serial.println("Firebase queue full; dropped event");
  }
}

void firebaseUploaderTask(void*) {
  static const uint8_t MAX_UPLOAD_RETRIES = 4;
  for (;;) {
    kickWifiConnect();
    if (WiFi.status() != WL_CONNECTED) {
      const uint32_t now = millis();
      if (now - lastFirebaseDiagMs > 3000) {
        Serial.println("Firebase: waiting for WiFi");
        lastFirebaseDiagMs = now;
      }
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    if (!provisioned) {
      logFirebaseTaskVitals("before_provision");
      if (!provisionDevice()) {
        const uint32_t now = millis();
        if (now - lastFirebaseDiagMs > 3000) {
          Serial.println("Firebase: provision failed, retrying");
          lastFirebaseDiagMs = now;
        }
        vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
        continue;
      }
      Serial.println("Firebase: provisioned");
      logFirebaseTaskVitals("after_provision");
    }

    if (!firebaseReady) {
      logFirebaseTaskVitals("before_signin");
      if (!signInToFirebaseWithCustomToken()) {
        const uint32_t now = millis();
        if (now - lastFirebaseDiagMs > 3000) {
          Serial.println("Firebase: sign-in failed, retrying");
          lastFirebaseDiagMs = now;
        }
        vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
        continue;
      }
      Serial.println("Firebase: signed in");
      logFirebaseTaskVitals("after_signin");
    }

    if (!ensureFirebaseReady()) {
      firebaseReady = false;
      const uint32_t now = millis();
      if (now - lastFirebaseDiagMs > 3000) {
        Serial.println("Firebase: token refresh failed, retrying");
        lastFirebaseDiagMs = now;
      }
      vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
      continue;
    }

    if (!refreshRadioNetworkConfigFromCloud(false)) {
      const uint32_t now = millis();
      if (now - lastFirebaseDiagMs > 3000) {
        Serial.println("Firebase: radio-network config fetch failed, retrying");
        lastFirebaseDiagMs = now;
      }
      vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
      continue;
    }

    if (!radioConfigLoaded) {
      vTaskDelay(pdMS_TO_TICKS(300));
      continue;
    }

    {
      const uint32_t now = millis();
      if (getNodeRole() == NodeRole::Gateway && shouldUseRadioNetwork() &&
          now - lastMeshStatusPublishMs >= MESH_STATUS_PUBLISH_INTERVAL_MS) {
        logFirebaseTaskVitals("before_status_publish");
        if (uploadMeshStatusSnapshot(now)) {
          lastMeshStatusPublishMs = now;
          logFirebaseTaskVitals("after_status_publish");
        }
      }
    }

    if (getNodeRole() != NodeRole::Gateway && !shouldUploadDirectToFirebase()) {
      vTaskDelay(pdMS_TO_TICKS(400));
      continue;
    }

    GatewayReading pending;
    if (xQueueReceive(firebaseQueue, &pending, pdMS_TO_TICKS(250)) != pdTRUE) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    if (uploadReadingEvent(pending)) {
      firebaseUploadedEvents++;
      continue;
    }

    firebaseFailedEvents++;
    pending.uploadRetries++;
    if (pending.uploadRetries <= MAX_UPLOAD_RETRIES) {
      xQueueSend(firebaseQueue, &pending, 0);
    }
    vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
  }
}

void applyConfigSyncPacket(const MeshPacketPayload& pkt) {
  if (pkt.configVersion < desiredConfig.version) return;

  if ((pkt.flags & 0x01) != 0U) {
    clearNetworkConfig(desiredConfig);
    desiredConfig.version = pkt.configVersion;
  }

  if (pkt.targetNodeId != 0) {
    const MeshNodeRole role = pkt.targetRole == static_cast<uint8_t>(MeshNodeRole::Gateway)
      ? MeshNodeRole::Gateway
      : MeshNodeRole::Client;

    upsertNodeConfig(
      desiredConfig,
      "",
      pkt.targetNodeId,
      role,
      "",
      pkt.preferredGatewayId,
      "",
      pkt.fallbackGatewayId,
      true
    );
  }

  if ((pkt.flags & 0x02) != 0U) {
    applyLocalNodeConfig("mesh_sync");
    Serial.printf("Applied synced config version %u\n", static_cast<unsigned int>(desiredConfig.version));
  }
}

void sendConfigSyncFrame(bool isStart, bool isEnd, const NodeConfigEntry* entry, uint32_t seq) {
  MeshPacketPayload packet = {};
  packet.msgType = static_cast<uint8_t>(MeshMsgType::ConfigSync);
  packet.nodeId = thisNodeId();
  packet.configVersion = desiredConfig.version;
  if (isStart) packet.flags |= 0x01;
  if (isEnd) packet.flags |= 0x02;
  packet.counter = seq;
  packet.uptimeMs = millis();
  copyDeviceId(packet.deviceId, sizeof(packet.deviceId), localDeviceId);

  if (entry != nullptr) {
    packet.targetNodeId = entry->nodeId;
    packet.targetRole = static_cast<uint8_t>(entry->role);
    if (entry->preferredGatewayId != 0) {
      packet.preferredGatewayId = entry->preferredGatewayId;
    } else if (textHasValue(entry->preferredGatewayDeviceId)) {
      const NodeConfigEntry* preferredGateway = findNodeConfigByDeviceId(entry->preferredGatewayDeviceId);
      if (preferredGateway != nullptr) packet.preferredGatewayId = preferredGateway->nodeId;
    }
    if (entry->fallbackGatewayId != 0) {
      packet.fallbackGatewayId = entry->fallbackGatewayId;
    } else if (textHasValue(entry->fallbackGatewayDeviceId)) {
      const NodeConfigEntry* fallbackGateway = findNodeConfigByDeviceId(entry->fallbackGatewayDeviceId);
      if (fallbackGateway != nullptr) packet.fallbackGatewayId = fallbackGateway->nodeId;
    }
  }

  radio.createPacketAndSend(BROADCAST_ADDR, &packet, 1);
}

void broadcastDesiredConfigIfDue(uint32_t now) {
  if (getNodeRole() != NodeRole::Gateway || !shouldUseRadioNetwork()) return;
  if (now - lastConfigSyncMs < CONFIG_SYNC_INTERVAL_MS) return;
  lastConfigSyncMs = now;

  uint32_t seq = 0;
  sendConfigSyncFrame(true, false, nullptr, seq++);
  delay(CONFIG_SYNC_FRAME_GAP_MS);
  for (size_t i = 0; i < desiredConfig.nodeCount; ++i) {
    sendConfigSyncFrame(false, false, &desiredConfig.nodes[i], seq++);
    delay(CONFIG_SYNC_FRAME_GAP_MS);
  }
  sendConfigSyncFrame(false, true, nullptr, seq++);
}

uint16_t chooseDestination(bool& reliable) {
  reliable = false;
  if (!shouldUseRadioNetwork()) return 0;
  if (getNodeRole() == NodeRole::Gateway) return BROADCAST_ADDR;

  uint16_t addr = 0;
  if (resolveGatewayAddress(preferredGatewayDeviceId, preferredGatewayNodeId, addr)) {
    reliable = true;
    return addr;
  }
  if (resolveGatewayAddress(fallbackGatewayDeviceId, fallbackGatewayNodeId, addr)) {
    reliable = true;
    return addr;
  }

  RouteNode* closestGateway = LoraMesher::getClosestGateway();
  if (closestGateway != nullptr) {
    reliable = true;
    return closestGateway->networkNode.address;
  }

  return BROADCAST_ADDR;
}

void processReceivedPackets(void*) {
  for (;;) {
    ulTaskNotifyTake(pdPASS, portMAX_DELAY);

    while (radio.getReceivedQueueSize() > 0) {
      AppPacket<MeshPacketPayload>* packet = radio.getNextAppPacket<MeshPacketPayload>();
      if (packet == nullptr) continue;

      const size_t payloadLength = packet->getPayloadLength();
      for (size_t i = 0; i < payloadLength; ++i) {
        const MeshPacketPayload& p = packet->payload[i];
        const MeshMsgType msgType = static_cast<MeshMsgType>(p.msgType);

        upsertNodeAddress(p.nodeId, packet->src);
        noteNodeSeen(p.deviceId, p.nodeId, packet->src, millis());

        if (msgType == MeshMsgType::ConfigSync) {
          Serial.printf(
            "RX cfg local=0x%X from=0x%X srcNode=%u ver=%u flags=0x%X targetNode=%u targetRole=%u\n",
            localAddr,
            packet->src,
            static_cast<unsigned int>(p.nodeId),
            static_cast<unsigned int>(p.configVersion),
            static_cast<unsigned int>(p.flags),
            static_cast<unsigned int>(p.targetNodeId),
            static_cast<unsigned int>(p.targetRole)
          );
          applyConfigSyncPacket(p);
          continue;
        }

        if (msgType == MeshMsgType::AppAck) {
          Serial.printf(
            "RX ack local=0x%X from=0x%X srcNode=%u counter=%lu\n",
            localAddr,
            packet->src,
            static_cast<unsigned int>(p.nodeId),
            static_cast<unsigned long>(p.counter)
          );
          continue;
        }

        Serial.printf(
          "RX %s local=0x%X from=0x%X srcNode=%u counter=%lu reading=%ld dev=%s msgType=%u\n",
          getNodeRole() == NodeRole::Gateway ? "gateway" : "client",
          localAddr,
          packet->src,
          static_cast<unsigned int>(p.nodeId),
          static_cast<unsigned long>(p.counter),
          static_cast<long>(p.readingRaw),
          p.deviceId,
          static_cast<unsigned int>(p.msgType)
        );

        if (msgType == MeshMsgType::Reading && getNodeRole() == NodeRole::Gateway) {
          queueFirebaseUploadEvent(false, packet->src, p, millis());
          MeshPacketPayload ack = p;
          ack.msgType = static_cast<uint8_t>(MeshMsgType::AppAck);
          ack.nodeId = thisNodeId();
          radio.sendReliable(packet->src, &ack, 1);
        }
      }

      radio.deletePacket(packet);
    }
  }
}

void createTasks() {
  BaseType_t rxRc = xTaskCreate(processReceivedPackets, "LM_RX", 6144, nullptr, 3, &receiveTaskHandle);
  if (rxRc != pdPASS) {
    Serial.printf("Failed to create RX task (err=%d)\n", static_cast<int>(rxRc));
  }

  BaseType_t fbRc = xTaskCreate(
    firebaseUploaderTask,
    "FB_UP",
    FIREBASE_TASK_STACK_BYTES,
    nullptr,
    1,
    &firebaseTaskHandle
  );
  if (fbRc != pdPASS) {
    Serial.printf("Failed to create Firebase task (err=%d)\n", static_cast<int>(fbRc));
  }
}

void setupLoRaMesher() {
  LoraMesher::LoraMesherConfig config;
  config.loraCs = LORA_SS;
  config.loraRst = LORA_RST;
  config.loraIrq = LORA_DIO0;
  config.module = LoraMesher::LoraModules::RFM95_MOD;
  config.freq = 915.0;
  config.sf = 7;
  config.power = 17;

  radio.begin(config);
  syncLoRaRoleFlag();
  radio.setReceiveAppDataTaskHandle(receiveTaskHandle);
  radio.start();
  localAddr = radio.getLocalAddress();
}

void resetRoleTiming(NodeRole role) {
  const uint32_t now = millis();
  lastSendMs = now - (role == NodeRole::Gateway ? GATEWAY_SEND_INTERVAL_MS : CLIENT_SEND_INTERVAL_MS);
}

void applyRoleChangeIfPending() {
  if (!applyPendingNodeRole()) return;
  syncLoRaRoleFlag();
  makeLocalDeviceId();
  resetRoleTiming(getNodeRole());
  if (getNodeRole() == NodeRole::Client && shouldUseRadioNetwork()) {
    firebaseReady = false;
  }
}

void emitTxByRole(uint32_t now) {
  if (!radioConfigLoaded) return;

  const uint32_t interval = getNodeRole() == NodeRole::Gateway ? GATEWAY_SEND_INTERVAL_MS : CLIENT_SEND_INTERVAL_MS;
  if (now - lastSendMs < interval) return;

  MeshPacketPayload payload = {};
  payload.msgType = static_cast<uint8_t>(MeshMsgType::Reading);
  payload.nodeId = thisNodeId();
  payload.configVersion = desiredConfig.version;
  payload.counter = txCounter++;
  payload.uptimeMs = now;
  payload.readingRaw = static_cast<int32_t>(payload.counter % 1000);
  copyDeviceId(payload.deviceId, sizeof(payload.deviceId), localDeviceId);

  if (shouldUploadDirectToFirebase()) {
    queueFirebaseUploadEvent(true, 0, payload, now);
    lastSendMs = now;
    return;
  }

  if (!shouldUseRadioNetwork()) return;

  bool reliable = false;
  const uint16_t dest = chooseDestination(reliable);
  if (dest == 0) return;
  if (reliable) {
    radio.sendReliable(dest, &payload, 1);
  } else {
    radio.createPacketAndSend(dest, &payload, 1);
  }

  if (getNodeRole() == NodeRole::Gateway) {
    queueFirebaseUploadEvent(true, dest, payload, now);
  }

  lastSendMs = now;
}

void parseSerialCommands() {
  while (Serial.available() > 0) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\r') continue;
    if (ch != '\n') {
      serialLine += ch;
      continue;
    }

    serialLine.trim();
    serialLine.toLowerCase();

    if (serialLine == "role gateway") {
      requestNodeRole(NodeRole::Gateway, "serial");
    } else if (serialLine == "role client") {
      requestNodeRole(NodeRole::Client, "serial");
    } else if (serialLine == "config") {
      dumpDesiredConfig();
    } else if (serialLine == "cfgreload") {
      refreshRadioNetworkConfigFromCloud(true);
    }

    serialLine = "";
  }
}

}  // namespace srproj

void srproj::appSetup() {
  Serial.begin(115200);
  delay(1500);

  initNodeRole(SR_START_AS_GATEWAY ? NodeRole::Gateway : NodeRole::Client);
  initDeviceConfigPortal({
    DEFAULT_WIFI_SSID,
    DEFAULT_WIFI_PASSWORD,
    DEFAULT_BACKEND_BASE_URL,
    DEFAULT_DEVICE_ID,
    DEFAULT_DEVICE_SECRET,
    DEFAULT_FIREBASE_API_KEY,
    DEFAULT_FIREBASE_DATABASE_URL,
    SR_NODE_ID,
  });
  makeLocalDeviceId();
  clearNetworkConfig(desiredConfig);
  radioConfigLoaded = false;

  firebaseQueue = xQueueCreate(FIREBASE_QUEUE_LEN, sizeof(GatewayReading));
  if (firebaseQueue == nullptr) {
    Serial.println("Failed to create Firebase queue");
  }

  createTasks();
  setupLoRaMesher();
  resetRoleTiming(getNodeRole());
  Serial.printf(
    "Boot nodeId=%u deviceId=%s role=%s (waiting for Firebase radio-network config)\n",
    static_cast<unsigned int>(thisNodeId()),
    localDeviceId,
    nodeRoleName(getNodeRole())
  );
}

void srproj::appLoop() {
  serviceDeviceConfigPortal();
  parseSerialCommands();
  applyRoleChangeIfPending();

  const uint32_t now = millis();
  broadcastDesiredConfigIfDue(now);
  emitTxByRole(now);

  static uint32_t lastAliveMs = 0;
  if (now - lastAliveMs >= 3000) {
    const char* mode =
      !radioConfigLoaded ? "awaiting-config" :
      (shouldUploadDirectToFirebase() ? "wifi-direct" :
      (getNodeRole() == NodeRole::Gateway ? "mesh-gateway" : "mesh-client"));
    Serial.printf(
      "alive mode=%s role=%s node=%u local=0x%X tx=%lu prefGw=%u prefDev=%s fbGw=%u fbDev=%s cfgV=%u fbQ=%lu fbUp=%lu fbFail=%lu\n",
      mode,
      nodeRoleName(getNodeRole()),
      static_cast<unsigned int>(thisNodeId()),
      localAddr,
      static_cast<unsigned long>(txCounter),
      static_cast<unsigned int>(preferredGatewayNodeId),
      preferredGatewayDeviceId,
      static_cast<unsigned int>(fallbackGatewayNodeId),
      fallbackGatewayDeviceId,
      static_cast<unsigned int>(desiredConfig.version),
      static_cast<unsigned long>(firebaseQueuedEvents),
      static_cast<unsigned long>(firebaseUploadedEvents),
      static_cast<unsigned long>(firebaseFailedEvents)
    );
    lastAliveMs = now;
  }

  delay(5);
}
