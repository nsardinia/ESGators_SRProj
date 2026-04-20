#include <Arduino.h>
#include <LoRaMesher.h>
#include <cstring>

// Non-gateway test node: sends readings to gateway and receives gateway packets.
// It does NOT perform any Firebase/WiFi work.

static const uint8_t NODE_ID = 1;
static const uint16_t DESTINATION_ADDR = BROADCAST_ADDR;  // Set gateway addr when known.

static const uint8_t LORA_SS = 21;
static const uint8_t LORA_RST = 18;
static const uint8_t LORA_DIO0 = 5;

static const uint32_t SEND_INTERVAL_MS = 5300;
static const uint32_t SEND_PHASE_OFFSET_MS = 2500;
static const size_t MAX_DEVICE_ID_LEN = 64;

static const char* CLIENT_DEVICE_ID = "dev_client_node_1";

struct LoraReadingPayload {
  uint8_t nodeId;
  uint32_t counter;
  uint32_t uptimeMs;
  int32_t readingRaw;
  char deviceId[MAX_DEVICE_ID_LEN];
};

LoraMesher& radio = LoraMesher::getInstance();
TaskHandle_t receiveTaskHandle = nullptr;

static uint32_t txCounter = 0;
static uint32_t lastSendMs = 0;
static uint16_t localAddr = 0;
static uint32_t totalRxPackets = 0;

void copyDeviceId(char* dst, size_t dstLen, const char* src) {
  if (dstLen == 0) {
    return;
  }

  if (src == nullptr) {
    dst[0] = '\0';
    return;
  }

  strncpy(dst, src, dstLen - 1);
  dst[dstLen - 1] = '\0';
}

void processReceivedPackets(void*) {
  for (;;) {
    ulTaskNotifyTake(pdPASS, portMAX_DELAY);

    while (radio.getReceivedQueueSize() > 0) {
      AppPacket<LoraReadingPayload>* packet = radio.getNextAppPacket<LoraReadingPayload>();
      if (packet == nullptr) {
        continue;
      }

      const size_t payloadLength = packet->getPayloadLength();
      for (size_t i = 0; i < payloadLength; ++i) {
        const LoraReadingPayload& p = packet->payload[i];
        Serial.printf(
          "RX(local test node) from=0x%X node=%u counter=%lu reading=%ld dev=%s (ignored)\n",
          packet->src,
          p.nodeId,
          static_cast<unsigned long>(p.counter),
          static_cast<long>(p.readingRaw),
          p.deviceId
        );
        totalRxPackets++;
      }

      // Intentionally ignore application logic for received packets.
      radio.deletePacket(packet);
    }
  }
}

void createReceiveTask() {
  BaseType_t rc = xTaskCreate(processReceivedPackets, "LM_RX", 4096, nullptr, 2, &receiveTaskHandle);
  if (rc != pdPASS) {
    Serial.printf("Failed to create RX task (err=%d)\n", static_cast<int>(rc));
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
  createReceiveTask();
  radio.setReceiveAppDataTaskHandle(receiveTaskHandle);
  radio.start();

  localAddr = radio.getLocalAddress();
  Serial.printf(
    "Client node started. NODE_ID=%u localAddr=0x%X dest=0x%X deviceId=%s\n",
    NODE_ID,
    localAddr,
    DESTINATION_ADDR,
    CLIENT_DEVICE_ID
  );
  lastSendMs = millis() + SEND_PHASE_OFFSET_MS - SEND_INTERVAL_MS;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("Booting non-gateway LoRa test node...");
  setupLoRaMesher();
}

void loop() {
  const uint32_t now = millis();
  if (now - lastSendMs >= SEND_INTERVAL_MS) {
    LoraReadingPayload payload;
    payload.nodeId = NODE_ID;
    payload.counter = txCounter++;
    payload.uptimeMs = now;
    payload.readingRaw = static_cast<int32_t>(payload.counter % 1000);
    copyDeviceId(payload.deviceId, sizeof(payload.deviceId), CLIENT_DEVICE_ID);

    radio.createPacketAndSend(DESTINATION_ADDR, &payload, 1);

    Serial.printf(
      "TX(client) local=0x%X -> dest=0x%X node=%u counter=%lu reading=%ld dev=%s\n",
      localAddr,
      DESTINATION_ADDR,
      NODE_ID,
      static_cast<unsigned long>(payload.counter),
      static_cast<long>(payload.readingRaw),
      payload.deviceId
    );

    lastSendMs = now;
  }

  static uint32_t lastAliveMs = 0;
  if (now - lastAliveMs >= 3000) {
    Serial.printf("alive(client) local=0x%X tx=%lu rx=%lu\n",
                  localAddr,
                  static_cast<unsigned long>(txCounter),
                  static_cast<unsigned long>(totalRxPackets));
    lastAliveMs = now;
  }

  delay(5);
}
