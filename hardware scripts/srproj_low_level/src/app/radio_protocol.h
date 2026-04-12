#pragma once

#include <Arduino.h>

namespace srproj {

static const size_t MAX_DEVICE_ID_LEN = 64;
static const size_t MAX_NETWORK_NODES = 32;
static const size_t MAX_GATEWAYS = 8;

enum class MeshMsgType : uint8_t {
  Reading = 1,
  AppAck = 2,
  ConfigSync = 3,
};

enum class MeshNodeRole : uint8_t {
  Client = 0,
  Gateway = 1,
};

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

struct NetworkConfigState {
  uint16_t version;
  size_t nodeCount;
  NodeConfigEntry nodes[MAX_NETWORK_NODES];
  size_t gatewayCount;
  char gateways[MAX_GATEWAYS][MAX_DEVICE_ID_LEN];
};

}  // namespace srproj
