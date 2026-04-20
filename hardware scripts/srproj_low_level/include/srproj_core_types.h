#pragma once

#include <cstddef>
#include <cstdint>

namespace srproj {

// Shared size limits used by both firmware code and host-side tests.
static const size_t MAX_DEVICE_ID_LEN = 48;
static const size_t MAX_NETWORK_NODES = 32;
static const size_t MAX_GATEWAYS = 8;

// Wire-level application message categories exchanged over the mesh.
enum class MeshMsgType : uint8_t {
  Reading = 1,
  AppAck = 2,
  ConfigSync = 3,
};

// High-level role assigned to a device within the radio network.
enum class MeshNodeRole : uint8_t {
  Client = 0,
  Gateway = 1,
};

// Radio payload shape shared between the app and the routing layer.
struct MeshPacketPayload {
  uint8_t msgType;
  uint8_t nodeId;
  uint16_t configVersion;
  uint8_t targetNodeId;
  uint8_t targetRole;
  uint8_t preferredGatewayId;
  uint8_t fallbackGatewayId;
  uint8_t flags;
  uint32_t counter;
  uint32_t uptimeMs;
  int32_t readingRaw;
  uint8_t sensorFlags;
  int16_t temperatureCentiC;
  uint16_t humidityCentiPct;
  uint16_t no2Raw;
  uint16_t no2MilliVolts;
  uint16_t soundRaw;
  uint16_t soundMilliVolts;
  char deviceId[MAX_DEVICE_ID_LEN];
};

// Normalized sensor event shape used when queueing cloud uploads.
struct GatewayReading {
  bool isTx;
  uint16_t localAddr;
  uint16_t peerAddr;
  uint8_t nodeId;
  uint32_t counter;
  uint32_t uptimeMs;
  int32_t readingRaw;
  uint8_t sensorFlags;
  int16_t temperatureCentiC;
  uint16_t humidityCentiPct;
  uint16_t no2Raw;
  uint16_t no2MilliVolts;
  uint16_t soundRaw;
  uint16_t soundMilliVolts;
  uint32_t eventAtMs;
  uint8_t uploadRetries;
  char sourceDeviceId[MAX_DEVICE_ID_LEN];
};

// One desired node entry from the active network configuration.
struct NodeConfigEntry {
  uint8_t nodeId;
  MeshNodeRole role;
  uint8_t preferredGatewayId;
  uint8_t fallbackGatewayId;
  bool enabled;
  char deviceId[MAX_DEVICE_ID_LEN];
  char preferredGatewayDeviceId[MAX_DEVICE_ID_LEN];
  char fallbackGatewayDeviceId[MAX_DEVICE_ID_LEN];
  uint16_t lastKnownAddress;
  uint32_t lastSeenMs;
};

// In-memory snapshot of the desired mesh topology and gateway list.
struct NetworkConfigState {
  uint16_t version;
  size_t nodeCount;
  NodeConfigEntry nodes[MAX_NETWORK_NODES];
  size_t gatewayCount;
  char gateways[MAX_GATEWAYS][MAX_DEVICE_ID_LEN];
};

// Mapping between logical node IDs and LoRaMesher addresses.
struct NodeAddressEntry {
  uint8_t nodeId;
  uint16_t address;
};

}  // namespace srproj
