#include "app_internal.h"

namespace srproj {

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
    upsertNodeConfig(desiredConfig, "", pkt.targetNodeId, role, "", pkt.preferredGatewayId, "",
                     pkt.fallbackGatewayId, true);
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
    if (entry->preferredGatewayId != 0) packet.preferredGatewayId = entry->preferredGatewayId;
    else if (textHasValue(entry->preferredGatewayDeviceId)) {
      const NodeConfigEntry* preferredGateway = findNodeConfigByDeviceId(entry->preferredGatewayDeviceId);
      if (preferredGateway != nullptr) packet.preferredGatewayId = preferredGateway->nodeId;
    }
    if (entry->fallbackGatewayId != 0) packet.fallbackGatewayId = entry->fallbackGatewayId;
    else if (textHasValue(entry->fallbackGatewayDeviceId)) {
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
          Serial.printf("RX cfg local=0x%X from=0x%X srcNode=%u ver=%u flags=0x%X targetNode=%u targetRole=%u\n",
                        localAddr, packet->src, static_cast<unsigned int>(p.nodeId),
                        static_cast<unsigned int>(p.configVersion), static_cast<unsigned int>(p.flags),
                        static_cast<unsigned int>(p.targetNodeId), static_cast<unsigned int>(p.targetRole));
          applyConfigSyncPacket(p);
          continue;
        }

        if (msgType == MeshMsgType::AppAck) {
          Serial.printf("RX ack local=0x%X from=0x%X srcNode=%u counter=%lu\n", localAddr, packet->src,
                        static_cast<unsigned int>(p.nodeId), static_cast<unsigned long>(p.counter));
          continue;
        }

        Serial.printf("RX %s local=0x%X from=0x%X srcNode=%u counter=%lu reading=%ld dev=%s msgType=%u\n",
                      getNodeRole() == NodeRole::Gateway ? "gateway" : "client", localAddr, packet->src,
                      static_cast<unsigned int>(p.nodeId), static_cast<unsigned long>(p.counter),
                      static_cast<long>(p.readingRaw), p.deviceId, static_cast<unsigned int>(p.msgType));

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
  if (rxRc != pdPASS) Serial.printf("Failed to create RX task (err=%d)\n", static_cast<int>(rxRc));

  BaseType_t fbRc = xTaskCreate(firebaseUploaderTask, "FB_UP", FIREBASE_TASK_STACK_BYTES, nullptr, 1, &firebaseTaskHandle);
  if (fbRc != pdPASS) Serial.printf("Failed to create Firebase task (err=%d)\n", static_cast<int>(fbRc));
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
  if (getNodeRole() == NodeRole::Client && shouldUseRadioNetwork()) firebaseReady = false;
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
  copyDeviceId(payload.deviceId, sizeof(payload.deviceId), localDeviceId);

  SensorSnapshot snapshot = {};
  if (getLatestSensorSnapshot(snapshot)) {
    payload.sensorFlags = snapshot.flags;
    payload.temperatureCentiC = static_cast<int16_t>(lroundf(snapshot.temperatureC * 100.0f));
    payload.humidityCentiPct = static_cast<uint16_t>(lroundf(snapshot.humidityPct * 100.0f));
    payload.no2Raw = snapshot.no2Raw;
    payload.no2MilliVolts = snapshot.no2MilliVolts;
    payload.soundRaw = snapshot.soundRaw;
    payload.soundMilliVolts = snapshot.soundMilliVolts;
    payload.readingRaw = static_cast<int32_t>(snapshot.no2Raw);
  } else {
    payload.readingRaw = -1;
  }

  if (shouldUploadDirectToFirebase()) {
    queueFirebaseUploadEvent(true, 0, payload, now);
    lastSendMs = now;
    return;
  }
  if (!shouldUseRadioNetwork()) return;

  bool reliable = false;
  const uint16_t dest = chooseDestination(reliable);
  if (dest == 0) return;
  if (reliable) radio.sendReliable(dest, &payload, 1);
  else radio.createPacketAndSend(dest, &payload, 1);

  if (getNodeRole() == NodeRole::Gateway) queueFirebaseUploadEvent(true, dest, payload, now);
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

    if (serialLine == "role gateway") requestNodeRole(NodeRole::Gateway, "serial");
    else if (serialLine == "role client") requestNodeRole(NodeRole::Client, "serial");
    else if (serialLine == "config") dumpDesiredConfig();
    else if (serialLine == "cfgreload") refreshRadioNetworkConfigFromCloud(true);

    serialLine = "";
  }
}

}  // namespace srproj
