#include "app_internal.h"

namespace srproj {

const uint8_t DEFAULT_GATEWAY_NODE_ID = SR_GATEWAY_NODE_ID;
const uint8_t LORA_SS = 21;
const uint8_t LORA_RST = 18;
const uint8_t LORA_DIO0 = 5;

const uint32_t GATEWAY_SEND_INTERVAL_MS = 4700;
const uint32_t CLIENT_SEND_INTERVAL_MS = 1000;
const uint32_t CONFIG_SYNC_INTERVAL_MS = 8000;
const uint32_t CONFIG_SYNC_FRAME_GAP_MS = 120;
const uint32_t CLOUD_CONFIG_REFRESH_MS = 15000;
const uint32_t WIFI_RETRY_MS = 10000;
const uint32_t UPLOAD_RETRY_MS = 2000;
const uint32_t HTTP_CONNECT_TIMEOUT_MS = 15000;
const uint32_t HTTP_TIMEOUT_MS = 20000;
const size_t FIREBASE_QUEUE_LEN = 24;
const uint32_t FIREBASE_UPLOAD_MIN_INTERVAL_MS = 5000;
const uint32_t MESH_STATUS_PUBLISH_INTERVAL_MS = 3000;
const uint32_t NODE_STALE_TIMEOUT_MS = 60000;
const uint32_t FIREBASE_TASK_STACK_BYTES = 16384;

const char* NETWORK_ENV_FALLBACK_JSON = R"json(
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

const char* DEFAULT_WIFI_SSID = "Nicks Iphone";
const char* DEFAULT_WIFI_PASSWORD = "Smok73ey10!";
const char* DEFAULT_BACKEND_BASE_URL = "https://srprojmwbe.fly.dev";
const char* DEFAULT_DEVICE_ID = SR_DEFAULT_DEVICE_ID;
const char* DEFAULT_DEVICE_SECRET = SR_DEFAULT_DEVICE_SECRET;
const char* DEFAULT_FIREBASE_API_KEY = "AIzaSyBRaPh-PIQ-7PkDIG0JzzlBl39FI5MWLiI";
const char* DEFAULT_FIREBASE_DATABASE_URL = "https://senior-project-esgators-default-rtdb.firebaseio.com/";
const bool ALLOW_INSECURE_TLS = true;

LoraMesher& radio = LoraMesher::getInstance();
TaskHandle_t receiveTaskHandle = nullptr;
TaskHandle_t firebaseTaskHandle = nullptr;
QueueHandle_t firebaseQueue = nullptr;

uint32_t txCounter = 0;
uint32_t lastSendMs = 0;
uint32_t lastConfigSyncMs = 0;
uint16_t localAddr = 0;
String serialLine;
char localDeviceId[MAX_DEVICE_ID_LEN] = {0};

NetworkConfigState desiredConfig = {};
uint8_t preferredGatewayNodeId = DEFAULT_GATEWAY_NODE_ID;
uint8_t fallbackGatewayNodeId = 0;
char preferredGatewayDeviceId[MAX_DEVICE_ID_LEN] = {0};
char fallbackGatewayDeviceId[MAX_DEVICE_ID_LEN] = {0};
bool radioConfigLoaded = false;
bool localDeviceInRadioNetwork = false;
uint32_t lastCloudConfigFetchMs = 0;

NodeAddressEntry nodeAddressTable[MAX_NETWORK_NODES];
size_t nodeAddressCount = 0;
bool firebaseReady = false;
bool provisioned = false;
uint32_t firebaseIdTokenExpiresAtMs = 0;
uint32_t lastWifiAttemptMs = 0;
String provisionedDeviceId;
String firebaseCustomToken;
String firebaseUid;
String ownerFirebaseUid;
String firebaseIdToken;
String firebaseRefreshToken;
uint32_t firebaseQueuedEvents = 0;
uint32_t firebaseUploadedEvents = 0;
uint32_t firebaseFailedEvents = 0;
uint32_t lastFirebaseDiagMs = 0;
uint32_t lastMeshStatusPublishMs = 0;

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

bool parseOwnerFirebaseUidFromDeviceSecret(const char* deviceSecret, String& ownerUidOut) {
  ownerUidOut = "";
  if (!textHasValue(deviceSecret)) return false;

  const String secret = String(deviceSecret);
  const int firstDot = secret.indexOf('.');
  if (firstDot <= 0) return false;

  const int secondDot = secret.indexOf('.', firstDot + 1);
  if (secondDot <= firstDot + 1) return false;
  if (secret.substring(0, firstDot) != "esg1") return false;

  ownerUidOut = secret.substring(firstDot + 1, secondDot);
  ownerUidOut.trim();
  return !ownerUidOut.isEmpty();
}

String firebaseUserBasePath() {
  if (ownerFirebaseUid.isEmpty()) return String();
  return String("users/") + ownerFirebaseUid;
}

String firebaseDeviceBasePath(const String& deviceId) {
  if (deviceId.isEmpty()) return String();
  const String userBasePath = firebaseUserBasePath();
  if (userBasePath.isEmpty()) return String();
  return userBasePath + "/devices/" + deviceId;
}

String provisionedFirebaseDeviceBasePath() {
  return firebaseDeviceBasePath(provisionedDeviceId);
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

}  // namespace srproj
