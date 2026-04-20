#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include "../../include/srproj_core_types.h"

namespace srproj {

// Pure helpers that stay independent from Arduino, WiFi, and LoRa libraries.
void coreCopyDeviceId(char* dst, size_t dstLen, const char* src);
bool coreTextEquals(const char* lhs, const char* rhs);
bool coreTextHasValue(const char* value);

// Extract provisioning metadata from the device secret format used by the app.
bool coreParseOwnerFirebaseUid(const char* deviceSecret, std::string& ownerUidOut);

// Parse role text from JSON/config payloads into the internal enum.
bool coreParseMeshRole(const char* roleString, MeshNodeRole& roleOut);

// Config-table helpers shared by firmware logic and host-side unit tests.
int coreFindNodeConfigIndex(const NetworkConfigState& cfg, uint8_t nodeId);
int coreFindNodeConfigIndexByDeviceId(const NetworkConfigState& cfg, const char* deviceId);
void coreClearNetworkConfig(NetworkConfigState& cfg);
void coreEnsureGatewayListed(NetworkConfigState& cfg, const char* gatewayDeviceId);
void coreUpsertNodeConfig(
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

// Lookup-table helpers for resolving radio node IDs and mesh addresses.
void coreUpsertNodeAddress(NodeAddressEntry* table, size_t& count, uint8_t nodeId, uint16_t address);
bool coreLookupAddressByNodeId(const NodeAddressEntry* table, size_t count, uint8_t nodeId, uint16_t& out);
bool coreLookupNodeIdByAddress(const NodeAddressEntry* table, size_t count, uint16_t address, uint8_t& outNodeId);

// Contact freshness check used by mesh status reporting.
bool coreHasRecentNodeContact(
  const NodeConfigEntry& entry,
  const char* localDeviceId,
  uint32_t now,
  uint32_t staleTimeoutMs
);

// Minimal percent-encoding for Firebase form/query payloads.
std::string coreUrlEncode(const char* input);

}  // namespace srproj
