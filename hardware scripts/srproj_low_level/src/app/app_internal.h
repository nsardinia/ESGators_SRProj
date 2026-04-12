#pragma once

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LoRaMesher.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>

#include <cmath>
#include <cstring>

#include "device_config.h"
#include "node_role.h"
#include "radio_protocol.h"
#include "sensor_data.h"

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

extern const uint8_t DEFAULT_GATEWAY_NODE_ID;
extern const uint8_t LORA_SS;
extern const uint8_t LORA_RST;
extern const uint8_t LORA_DIO0;

extern const uint32_t GATEWAY_SEND_INTERVAL_MS;
extern const uint32_t CLIENT_SEND_INTERVAL_MS;
extern const uint32_t CONFIG_SYNC_INTERVAL_MS;
extern const uint32_t CONFIG_SYNC_FRAME_GAP_MS;
extern const uint32_t CLOUD_CONFIG_REFRESH_MS;
extern const uint32_t WIFI_RETRY_MS;
extern const uint32_t UPLOAD_RETRY_MS;
extern const uint32_t HTTP_CONNECT_TIMEOUT_MS;
extern const uint32_t HTTP_TIMEOUT_MS;
extern const size_t FIREBASE_QUEUE_LEN;
extern const uint32_t MESH_STATUS_PUBLISH_INTERVAL_MS;
extern const uint32_t NODE_STALE_TIMEOUT_MS;
extern const uint32_t FIREBASE_TASK_STACK_BYTES;

extern const char* NETWORK_ENV_FALLBACK_JSON;
extern const char* DEFAULT_WIFI_SSID;
extern const char* DEFAULT_WIFI_PASSWORD;
extern const char* DEFAULT_BACKEND_BASE_URL;
extern const char* DEFAULT_DEVICE_ID;
extern const char* DEFAULT_DEVICE_SECRET;
extern const char* DEFAULT_FIREBASE_API_KEY;
extern const char* DEFAULT_FIREBASE_DATABASE_URL;
extern const bool ALLOW_INSECURE_TLS;

extern LoraMesher& radio;
extern TaskHandle_t receiveTaskHandle;
extern TaskHandle_t firebaseTaskHandle;
extern QueueHandle_t firebaseQueue;

extern uint32_t txCounter;
extern uint32_t lastSendMs;
extern uint32_t lastConfigSyncMs;
extern uint16_t localAddr;
extern String serialLine;
extern char localDeviceId[MAX_DEVICE_ID_LEN];

extern NetworkConfigState desiredConfig;
extern uint8_t preferredGatewayNodeId;
extern uint8_t fallbackGatewayNodeId;
extern char preferredGatewayDeviceId[MAX_DEVICE_ID_LEN];
extern char fallbackGatewayDeviceId[MAX_DEVICE_ID_LEN];
extern bool radioConfigLoaded;
extern bool localDeviceInRadioNetwork;
extern uint32_t lastCloudConfigFetchMs;

extern NodeAddressEntry nodeAddressTable[MAX_NETWORK_NODES];
extern size_t nodeAddressCount;
extern bool firebaseReady;
extern bool provisioned;
extern uint32_t firebaseIdTokenExpiresAtMs;
extern uint32_t lastWifiAttemptMs;
extern String provisionedDeviceId;
extern String firebaseCustomToken;
extern String firebaseUid;
extern String ownerFirebaseUid;
extern String firebaseIdToken;
extern String firebaseRefreshToken;
extern uint32_t firebaseQueuedEvents;
extern uint32_t firebaseUploadedEvents;
extern uint32_t firebaseFailedEvents;
extern uint32_t lastFirebaseDiagMs;
extern uint32_t lastMeshStatusPublishMs;

void copyDeviceId(char* dst, size_t dstLen, const char* src);
bool textEquals(const char* lhs, const char* rhs);
bool textHasValue(const char* value);
bool parseOwnerFirebaseUidFromDeviceSecret(const char* deviceSecret, String& ownerUidOut);

String firebaseUserBasePath();
String firebaseDeviceBasePath(const String& deviceId);
String provisionedFirebaseDeviceBasePath();
uint8_t thisNodeId();
const char* meshRoleName(MeshNodeRole role);
bool parseMeshRole(const String& roleString, MeshNodeRole& roleOut);
const char* routeRoleName(uint8_t roleFlags);
void syncLoRaRoleFlag();
void makeLocalDeviceId();

void clearNetworkConfig(NetworkConfigState& cfg);
int findNodeConfigIndex(const NetworkConfigState& cfg, uint8_t nodeId);
int findNodeConfigIndexByDeviceId(const NetworkConfigState& cfg, const char* deviceId);
void ensureGatewayListed(NetworkConfigState& cfg, const char* gatewayDeviceId);
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
);
const NodeConfigEntry* getLocalNodeConfigEntry();
void applyLocalNodeConfig(const char* source);
bool parseNetworkConfigJson(const String& json, NetworkConfigState& outCfg);
bool isFirebaseNodeMissingPayload(const String& json);
bool loadNetworkConfigFromEnvJson();
void activateWifiDirectFallback(const char* source, const char* reason);
void dumpDesiredConfig();

void upsertNodeAddress(uint8_t nodeId, uint16_t address);
bool lookupAddressByNodeId(uint8_t nodeId, uint16_t& out);
bool lookupNodeIdByAddress(uint16_t address, uint8_t& outNodeId);
NodeConfigEntry* findMutableNodeConfigByDeviceId(const char* deviceId);
NodeConfigEntry* findMutableNodeConfigByNodeId(uint8_t nodeId);
const NodeConfigEntry* findNodeConfigByNodeId(uint8_t nodeId);
const NodeConfigEntry* findNodeConfigByDeviceId(const char* deviceId);
void noteNodeSeen(const char* deviceId, uint8_t nodeId, uint16_t address, uint32_t now);
bool hasRecentNodeContact(const NodeConfigEntry& entry, uint32_t now);
bool resolveGatewayAddress(const char* gatewayDeviceId, uint8_t gatewayNodeId, uint16_t& outAddr);
RouteSnapshot findRouteSnapshotByAddress(uint16_t address);
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
);

bool isHttpsUrl(const String& url);
void configureHttpClient(HTTPClient& http);
String urlEncode(const String& input);
void logFirebaseTaskVitals(const char* stage);
bool postJson(const String& url, const String& payload, int& statusCode, String& responseBody);
bool postForm(const String& url, const String& payload, int& statusCode, String& responseBody);
bool putJson(const String& url, const String& payload, int& statusCode, String& responseBody);
bool getJson(const String& url, int& statusCode, String& responseBody);
void kickWifiConnect();
bool provisionDevice();
bool signInToFirebaseWithCustomToken();
bool refreshFirebaseIdToken();
bool ensureFirebaseReady();
bool writeJsonByPath(const String& dbPath, const String& payload);
bool readJsonByPath(const String& dbPath, String& responseBody);
bool refreshRadioNetworkConfigFromCloud(bool force);
bool shouldUseRadioNetwork();
bool shouldUploadDirectToFirebase();
float decodeTemperatureC(const GatewayReading& msg);
float decodeHumidityPct(const GatewayReading& msg);
void appendSensorFields(JsonDocument& payloadDoc, const GatewayReading& msg);
void appendAggregateLatest(JsonDocument& payloadDoc, const GatewayReading& msg);
bool writeSensorBucketPayloads(const String& deviceBasePath, const GatewayReading& msg);
bool uploadDirectReading(const GatewayReading& msg);
bool uploadReadingEvent(const GatewayReading& msg);
bool uploadMeshStatusSnapshot(uint32_t now);
void queueFirebaseUploadEvent(bool isTx, uint16_t peerAddr, const MeshPacketPayload& payload, uint32_t eventAtMs);
void firebaseUploaderTask(void*);

void applyConfigSyncPacket(const MeshPacketPayload& pkt);
void sendConfigSyncFrame(bool isStart, bool isEnd, const NodeConfigEntry* entry, uint32_t seq);
void broadcastDesiredConfigIfDue(uint32_t now);
uint16_t chooseDestination(bool& reliable);
void processReceivedPackets(void*);
void createTasks();
void setupLoRaMesher();
void resetRoleTiming(NodeRole role);
void applyRoleChangeIfPending();
void emitTxByRole(uint32_t now);
void parseSerialCommands();

}  // namespace srproj
