#include <Arduino.h>
#include <LoRaMesher.h>

// RF diagnostics roles:
// 1 = Initiator (sends periodic PING broadcast, expects PONG replies)
// 2 = Responder (listens for PING, replies with PONG unicast)
// 3 = TX-only (sends periodic BEACON broadcast, no RX task)
// 4 = RX-only (receives only, no TX task)
#ifndef RF_DIAG_ROLE
#define RF_DIAG_ROLE 1
#endif

#ifndef RF_DIAG_NODE_ID
#define RF_DIAG_NODE_ID 1
#endif

static const uint8_t NODE_ID = RF_DIAG_NODE_ID;

// Radio wiring / params (same as project)
static const uint8_t LORA_SS = 21;
static const uint8_t LORA_RST = 18;
static const uint8_t LORA_DIO0 = 5;
static const uint32_t PING_INTERVAL_MS = 2000;
static const uint32_t BEACON_INTERVAL_MS = 1200;

LoraMesher& radio = LoraMesher::getInstance();
TaskHandle_t receiveTaskHandle = nullptr;
TaskHandle_t txTaskHandle = nullptr;
QueueHandle_t txQueue = nullptr;

struct DiagPacket {
  uint8_t senderNodeId;
  uint8_t msgType;   // 1=PING, 2=PONG, 3=BEACON
  uint32_t seq;
  uint32_t uptimeMs;
};

struct TxRequest {
  uint16_t dst;
  DiagPacket pkt;
};

static uint16_t localAddr = 0;
static uint32_t nextPingAtMs = 0;
static uint32_t pingSeq = 0;

static uint32_t rxPingCount = 0;
static uint32_t rxPongCount = 0;
static uint32_t txPingCount = 0;
static uint32_t txPongCount = 0;
static uint32_t txBeaconCount = 0;
static uint32_t txDropCount = 0;
static uint32_t rxBeaconCount = 0;

void enqueueTx(uint16_t dst, const DiagPacket& pkt) {
  if (txQueue == nullptr) {
    return;
  }

  TxRequest req;
  req.dst = dst;
  req.pkt = pkt;

  if (xQueueSend(txQueue, &req, 0) != pdTRUE) {
    txDropCount++;
    Serial.println("[DIAG] TX queue full; dropping packet");
  }
}

void txTask(void*) {
  for (;;) {
    TxRequest req;
    if (xQueueReceive(txQueue, &req, portMAX_DELAY) == pdTRUE) {
      radio.createPacketAndSend(req.dst, &req.pkt, 1);

      if (req.pkt.msgType == 1) {
        txPingCount++;
      } else if (req.pkt.msgType == 2) {
        txPongCount++;
      } else if (req.pkt.msgType == 3) {
        txBeaconCount++;
      }

      Serial.printf(
        "[DIAG] TX %s local=0x%X -> dst=0x%X seq=%lu\n",
        req.pkt.msgType == 1 ? "PING" : (req.pkt.msgType == 2 ? "PONG" : "BEACON"),
        localAddr,
        req.dst,
        static_cast<unsigned long>(req.pkt.seq)
      );

      // Tiny spacing to avoid immediate back-to-back contention.
      vTaskDelay(pdMS_TO_TICKS(20));
    }
  }
}

void processReceivedPackets(void*) {
  for (;;) {
    ulTaskNotifyTake(pdPASS, portMAX_DELAY);

    while (radio.getReceivedQueueSize() > 0) {
      AppPacket<DiagPacket>* packet = radio.getNextAppPacket<DiagPacket>();
      if (packet == nullptr) {
        continue;
      }

      const size_t payloadLength = packet->getPayloadLength();
      for (size_t i = 0; i < payloadLength; ++i) {
        const DiagPacket& p = packet->payload[i];

        if (p.msgType == 1) {
          rxPingCount++;
          Serial.printf(
            "[DIAG] RX PING local=0x%X from=0x%X node=%u seq=%lu\n",
            localAddr,
            packet->src,
            p.senderNodeId,
            static_cast<unsigned long>(p.seq)
          );

#if RF_DIAG_ROLE == 2
          // Responder sends unicast PONG back to exact sender address.
          DiagPacket pong;
          pong.senderNodeId = NODE_ID;
          pong.msgType = 2;
          pong.seq = p.seq;
          pong.uptimeMs = millis();
          enqueueTx(packet->src, pong);
#endif
        } else if (p.msgType == 2) {
          rxPongCount++;
          Serial.printf(
            "[DIAG] RX PONG local=0x%X from=0x%X node=%u seq=%lu\n",
            localAddr,
            packet->src,
            p.senderNodeId,
            static_cast<unsigned long>(p.seq)
          );
        } else if (p.msgType == 3) {
          rxBeaconCount++;
          Serial.printf(
            "[DIAG] RX BEACON local=0x%X from=0x%X node=%u seq=%lu\n",
            localAddr,
            packet->src,
            p.senderNodeId,
            static_cast<unsigned long>(p.seq)
          );
        } else {
          Serial.printf("[DIAG] RX unknown type=%u\n", p.msgType);
        }
      }

      radio.deletePacket(packet);
    }
  }
}

void createTasks() {
  const bool needRxTask = (RF_DIAG_ROLE == 1 || RF_DIAG_ROLE == 2 || RF_DIAG_ROLE == 4);
  const bool needTxTask = (RF_DIAG_ROLE == 1 || RF_DIAG_ROLE == 2 || RF_DIAG_ROLE == 3);

  if (needTxTask) {
    txQueue = xQueueCreate(32, sizeof(TxRequest));
    if (txQueue == nullptr) {
      Serial.println("[DIAG] Failed to create TX queue");
    }

    BaseType_t txRc = xTaskCreate(txTask, "DIAG_TX", 4096, nullptr, 2, &txTaskHandle);
    if (txRc != pdPASS) {
      Serial.printf("[DIAG] Failed to create TX task: %d\n", static_cast<int>(txRc));
    }
  }

  if (needRxTask) {
    BaseType_t rxRc = xTaskCreate(processReceivedPackets, "DIAG_RX", 4096, nullptr, 3, &receiveTaskHandle);
    if (rxRc != pdPASS) {
      Serial.printf("[DIAG] Failed to create RX task: %d\n", static_cast<int>(rxRc));
    }
  }
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
  if (receiveTaskHandle != nullptr) {
    radio.setReceiveAppDataTaskHandle(receiveTaskHandle);
  }
  radio.start();

  localAddr = radio.getLocalAddress();
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=== LoRa RF Diagnostic ===");
#if RF_DIAG_ROLE == 1
  Serial.println("Role: INITIATOR (PING sender)");
#elif RF_DIAG_ROLE == 2
  Serial.println("Role: RESPONDER (PONG reply)");
#elif RF_DIAG_ROLE == 3
  Serial.println("Role: TX-ONLY (BEACON sender)");
#elif RF_DIAG_ROLE == 4
  Serial.println("Role: RX-ONLY (listener)");
#else
  Serial.println("Role: UNKNOWN");
#endif

  createTasks();
  setupLoRaMesher();

  nextPingAtMs = millis() + 700;

  Serial.printf("NodeId=%u localAddr=0x%X\n", NODE_ID, localAddr);
}

void loop() {
  const uint32_t now = millis();

#if RF_DIAG_ROLE == 1
  if (now >= nextPingAtMs) {
    DiagPacket ping;
    ping.senderNodeId = NODE_ID;
    ping.msgType = 1;
    ping.seq = pingSeq++;
    ping.uptimeMs = now;

    enqueueTx(BROADCAST_ADDR, ping);
    nextPingAtMs = now + PING_INTERVAL_MS;
  }
#elif RF_DIAG_ROLE == 3
  if (now >= nextPingAtMs) {
    DiagPacket beacon;
    beacon.senderNodeId = NODE_ID;
    beacon.msgType = 3;
    beacon.seq = pingSeq++;
    beacon.uptimeMs = now;

    enqueueTx(BROADCAST_ADDR, beacon);
    nextPingAtMs = now + BEACON_INTERVAL_MS;
  }
#endif

  static uint32_t lastAliveMs = 0;
  if (now - lastAliveMs >= 3000) {
    Serial.printf(
      "[DIAG] alive local=0x%X txPing=%lu txPong=%lu txBeacon=%lu rxPing=%lu rxPong=%lu rxBeacon=%lu txDrop=%lu\n",
      localAddr,
      static_cast<unsigned long>(txPingCount),
      static_cast<unsigned long>(txPongCount),
      static_cast<unsigned long>(txBeaconCount),
      static_cast<unsigned long>(rxPingCount),
      static_cast<unsigned long>(rxPongCount),
      static_cast<unsigned long>(rxBeaconCount),
      static_cast<unsigned long>(txDropCount)
    );
    lastAliveMs = now;
  }

  delay(5);
}
