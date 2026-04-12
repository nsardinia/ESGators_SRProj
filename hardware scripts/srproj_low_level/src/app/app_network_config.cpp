#include "app_internal.h"

namespace srproj {

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

void upsertNodeConfig(NetworkConfigState& cfg, const char* deviceId, uint8_t nodeId, MeshNodeRole role,
                      const char* preferredGatewayDevice, uint8_t preferredGatewayNode,
                      const char* fallbackGatewayDevice, uint8_t fallbackGatewayNode, bool enabled) {
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
    upsertNodeConfig(parsed, deviceIdBuf, nodeId, role, preferredGatewayDeviceBuf, preferredGatewayNode,
                     fallbackGatewayDeviceBuf, fallbackGatewayNode,
                     nodeVar["enabled"].isNull() ? true : nodeVar["enabled"].as<bool>());
  }

  outCfg = parsed;
  return true;
}

bool isFirebaseNodeMissingPayload(const String& json) {
  String normalized = json;
  normalized.trim();
  return normalized.isEmpty() || normalized == "null";
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

void activateWifiDirectFallback(const char* source, const char* reason) {
  clearNetworkConfig(desiredConfig);
  applyLocalNodeConfig(source);
  radioConfigLoaded = true;
  lastCloudConfigFetchMs = millis();
  if (reason != nullptr && reason[0] != '\0') {
    Serial.printf("Firebase: %s; using WiFi-direct mode\n", reason);
  }
}

void dumpDesiredConfig() {
  Serial.printf("Desired config v%u nodes=%u gateways=%u\n",
                static_cast<unsigned int>(desiredConfig.version),
                static_cast<unsigned int>(desiredConfig.nodeCount),
                static_cast<unsigned int>(desiredConfig.gatewayCount));
  for (size_t i = 0; i < desiredConfig.nodeCount; ++i) {
    const NodeConfigEntry& n = desiredConfig.nodes[i];
    Serial.printf("  node=%u device=%s role=%s prefGw=%u prefDev=%s fbGw=%u fbDev=%s enabled=%u seen=%lu addr=0x%X\n",
                  static_cast<unsigned int>(n.nodeId), n.deviceId, meshRoleName(n.role),
                  static_cast<unsigned int>(n.preferredGatewayId), n.preferredGatewayDeviceId,
                  static_cast<unsigned int>(n.fallbackGatewayId), n.fallbackGatewayDeviceId,
                  n.enabled ? 1U : 0U, static_cast<unsigned long>(n.lastSeenMs), n.lastKnownAddress);
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

void appendMeshNodeStatus(JsonArray& nodes, const char* deviceId, uint8_t nodeId, uint16_t address,
                          const char* status, const char* role, uint8_t hops, uint16_t viaAddr, uint8_t viaNodeId) {
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

}  // namespace srproj
