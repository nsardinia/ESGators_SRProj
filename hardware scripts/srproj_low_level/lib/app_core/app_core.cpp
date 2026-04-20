#include "app_core.h"

#include <algorithm>
#include <cctype>
#include <cstring>

namespace srproj {

// Copy into fixed-size protocol/config buffers while always leaving a terminator.
void coreCopyDeviceId(char* dst, size_t dstLen, const char* src) {
  if (dstLen == 0) return;
  if (src == nullptr) {
    dst[0] = '\0';
    return;
  }
  std::strncpy(dst, src, dstLen - 1);
  dst[dstLen - 1] = '\0';
}

// Null-safe string comparison for config and routing lookups.
bool coreTextEquals(const char* lhs, const char* rhs) {
  if (lhs == nullptr || rhs == nullptr) return false;
  return std::strcmp(lhs, rhs) == 0;
}

// Treat nullptr and empty strings as "no value".
bool coreTextHasValue(const char* value) {
  return value != nullptr && value[0] != '\0';
}

// Expected device secret format is "esg1.<ownerUid>.<signature>".
bool coreParseOwnerFirebaseUid(const char* deviceSecret, std::string& ownerUidOut) {
  ownerUidOut.clear();
  if (!coreTextHasValue(deviceSecret)) return false;

  const std::string secret(deviceSecret);
  const size_t firstDot = secret.find('.');
  if (firstDot == std::string::npos || firstDot == 0) return false;

  const size_t secondDot = secret.find('.', firstDot + 1);
  if (secondDot == std::string::npos || secondDot <= firstDot + 1) return false;
  if (secret.substr(0, firstDot) != "esg1") return false;

  ownerUidOut = secret.substr(firstDot + 1, secondDot - firstDot - 1);
  ownerUidOut.erase(std::remove_if(ownerUidOut.begin(), ownerUidOut.end(), [](unsigned char ch) {
    return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n';
  }), ownerUidOut.end());
  return !ownerUidOut.empty();
}

// Role text comes from dashboard/cloud JSON and should be case-insensitive.
bool coreParseMeshRole(const char* roleString, MeshNodeRole& roleOut) {
  if (!coreTextHasValue(roleString)) return false;

  std::string role(roleString);
  std::transform(role.begin(), role.end(), role.begin(), [](unsigned char ch) {
    return static_cast<char>(std::tolower(ch));
  });

  if (role == "gateway") {
    roleOut = MeshNodeRole::Gateway;
    return true;
  }
  if (role == "client") {
    roleOut = MeshNodeRole::Client;
    return true;
  }
  return false;
}

// Find entries by node ID for config sync and address resolution.
int coreFindNodeConfigIndex(const NetworkConfigState& cfg, uint8_t nodeId) {
  for (size_t i = 0; i < cfg.nodeCount; ++i) {
    if (cfg.nodes[i].nodeId == nodeId) return static_cast<int>(i);
  }
  return -1;
}

// Device ID is preferred when present because node IDs can be reassigned.
int coreFindNodeConfigIndexByDeviceId(const NetworkConfigState& cfg, const char* deviceId) {
  if (!coreTextHasValue(deviceId)) return -1;
  for (size_t i = 0; i < cfg.nodeCount; ++i) {
    if (coreTextEquals(cfg.nodes[i].deviceId, deviceId)) return static_cast<int>(i);
  }
  return -1;
}

// Reset the full config snapshot before rebuilding it from cloud or mesh data.
void coreClearNetworkConfig(NetworkConfigState& cfg) {
  cfg.version = 0;
  cfg.nodeCount = 0;
  cfg.gatewayCount = 0;
  std::memset(cfg.nodes, 0, sizeof(cfg.nodes));
  std::memset(cfg.gateways, 0, sizeof(cfg.gateways));
}

// Gateway IDs are tracked as a deduplicated list for routing decisions.
void coreEnsureGatewayListed(NetworkConfigState& cfg, const char* gatewayDeviceId) {
  if (!coreTextHasValue(gatewayDeviceId)) return;
  for (size_t i = 0; i < cfg.gatewayCount; ++i) {
    if (coreTextEquals(cfg.gateways[i], gatewayDeviceId)) return;
  }
  if (cfg.gatewayCount >= MAX_GATEWAYS) return;
  coreCopyDeviceId(cfg.gateways[cfg.gatewayCount], sizeof(cfg.gateways[cfg.gatewayCount]), gatewayDeviceId);
  cfg.gatewayCount += 1;
}

// Update an existing node entry when possible so syncs do not duplicate records.
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
) {
  int idx = coreFindNodeConfigIndexByDeviceId(cfg, deviceId);
  if (idx < 0 && nodeId != 0) idx = coreFindNodeConfigIndex(cfg, nodeId);
  if (idx < 0) {
    if (cfg.nodeCount >= MAX_NETWORK_NODES) return;
    idx = static_cast<int>(cfg.nodeCount++);
  }

  coreCopyDeviceId(cfg.nodes[idx].deviceId, sizeof(cfg.nodes[idx].deviceId), deviceId);
  cfg.nodes[idx].nodeId = nodeId;
  cfg.nodes[idx].role = role;
  cfg.nodes[idx].preferredGatewayId = preferredGatewayNode;
  cfg.nodes[idx].fallbackGatewayId = fallbackGatewayNode;
  coreCopyDeviceId(
    cfg.nodes[idx].preferredGatewayDeviceId,
    sizeof(cfg.nodes[idx].preferredGatewayDeviceId),
    preferredGatewayDevice
  );
  coreCopyDeviceId(
    cfg.nodes[idx].fallbackGatewayDeviceId,
    sizeof(cfg.nodes[idx].fallbackGatewayDeviceId),
    fallbackGatewayDevice
  );
  cfg.nodes[idx].enabled = enabled;

  if (role == MeshNodeRole::Gateway) {
    coreEnsureGatewayListed(cfg, coreTextHasValue(deviceId) ? deviceId : preferredGatewayDevice);
  }
}

// Maintain a compact nodeId->address table for route resolution helpers.
void coreUpsertNodeAddress(NodeAddressEntry* table, size_t& count, uint8_t nodeId, uint16_t address) {
  if (table == nullptr || nodeId == 0 || address == 0) return;
  for (size_t i = 0; i < count; ++i) {
    if (table[i].nodeId == nodeId) {
      table[i].address = address;
      return;
    }
  }
  if (count >= MAX_NETWORK_NODES) return;
  table[count].nodeId = nodeId;
  table[count].address = address;
  count += 1;
}

// Resolve a mesh address from a logical node ID.
bool coreLookupAddressByNodeId(const NodeAddressEntry* table, size_t count, uint8_t nodeId, uint16_t& out) {
  if (table == nullptr) return false;
  for (size_t i = 0; i < count; ++i) {
    if (table[i].nodeId == nodeId) {
      out = table[i].address;
      return true;
    }
  }
  return false;
}

// Resolve a logical node ID from a mesh address.
bool coreLookupNodeIdByAddress(const NodeAddressEntry* table, size_t count, uint16_t address, uint8_t& outNodeId) {
  if (table == nullptr) return false;
  for (size_t i = 0; i < count; ++i) {
    if (table[i].address == address) {
      outNodeId = table[i].nodeId;
      return true;
    }
  }
  return false;
}

// The local device counts as reachable even without a recent radio heartbeat.
bool coreHasRecentNodeContact(
  const NodeConfigEntry& entry,
  const char* localDeviceId,
  uint32_t now,
  uint32_t staleTimeoutMs
) {
  if (!entry.enabled) return false;
  if (coreTextHasValue(entry.deviceId) && coreTextEquals(entry.deviceId, localDeviceId)) return true;
  if (entry.lastSeenMs == 0) return false;
  return now - entry.lastSeenMs <= staleTimeoutMs;
}

// Percent-encode non-safe characters for HTTP query and form payloads.
std::string coreUrlEncode(const char* input) {
  static const char* hex = "0123456789ABCDEF";
  if (input == nullptr) return std::string();

  std::string encoded;
  encoded.reserve(std::strlen(input) * 3);

  for (const unsigned char* current = reinterpret_cast<const unsigned char*>(input); *current != '\0'; ++current) {
    const unsigned char ch = *current;
    const bool safeChar =
      (ch >= 'a' && ch <= 'z') ||
      (ch >= 'A' && ch <= 'Z') ||
      (ch >= '0' && ch <= '9') ||
      ch == '-' || ch == '_' || ch == '.' || ch == '~';

    if (safeChar) {
      encoded.push_back(static_cast<char>(ch));
      continue;
    }

    encoded.push_back('%');
    encoded.push_back(hex[(ch >> 4) & 0x0F]);
    encoded.push_back(hex[ch & 0x0F]);
  }

  return encoded;
}

}  // namespace srproj
