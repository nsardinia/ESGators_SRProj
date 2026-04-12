#include "app.h"

#include "app_internal.h"

namespace srproj {

void appSetup() {
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
  initSensorSubsystem();

  firebaseQueue = xQueueCreate(FIREBASE_QUEUE_LEN, sizeof(GatewayReading));
  if (firebaseQueue == nullptr) Serial.println("Failed to create Firebase queue");

  createTasks();
  setupLoRaMesher();
  resetRoleTiming(getNodeRole());
  Serial.printf("Boot nodeId=%u deviceId=%s role=%s (waiting for Firebase radio-network config)\n",
                static_cast<unsigned int>(thisNodeId()), localDeviceId, nodeRoleName(getNodeRole()));
}

void appLoop() {
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
    Serial.printf("alive mode=%s role=%s node=%u local=0x%X tx=%lu prefGw=%u prefDev=%s fbGw=%u fbDev=%s cfgV=%u fbQ=%lu fbUp=%lu fbFail=%lu\n",
                  mode, nodeRoleName(getNodeRole()), static_cast<unsigned int>(thisNodeId()), localAddr,
                  static_cast<unsigned long>(txCounter), static_cast<unsigned int>(preferredGatewayNodeId),
                  preferredGatewayDeviceId, static_cast<unsigned int>(fallbackGatewayNodeId),
                  fallbackGatewayDeviceId, static_cast<unsigned int>(desiredConfig.version),
                  static_cast<unsigned long>(firebaseQueuedEvents),
                  static_cast<unsigned long>(firebaseUploadedEvents),
                  static_cast<unsigned long>(firebaseFailedEvents));
    lastAliveMs = now;
  }

  delay(5);
}

}  // namespace srproj