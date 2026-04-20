/**
 * Header file for device configuration portal.
 * 
 * Last edit: Nicholas Sardinia, 4/20/2026
 */
#pragma once

#include <Arduino.h>

namespace srproj {

struct DeviceConfigDefaults {
  const char* wifiSsid;
  const char* wifiPassword;
  const char* backendBaseUrl;
  const char* deviceId;
  const char* deviceSecret;
  const char* firebaseApiKey;
  const char* firebaseDatabaseUrl;
  uint8_t nodeId;
};

struct DeviceConfigState {
  char wifiSsid[64];
  char wifiPassword[64];
  char backendBaseUrl[128];
  char deviceId[64];
  char deviceSecret[96];
  char firebaseApiKey[96];
  char firebaseDatabaseUrl[128];
  uint8_t nodeId;
};

void initDeviceConfigPortal(const DeviceConfigDefaults& defaults);
void serviceDeviceConfigPortal();
const DeviceConfigState& getDeviceConfig();
uint8_t getConfiguredNodeId();

}  // namespace srproj
