#include <Arduino.h>
#include <LoRaMesher.h>

// Simple one-board radio smoke test: start LoRaMesher and send broadcast counters.
// Use this to verify the radio on a suspect board can initialize and transmit.

static const uint8_t LORA_SS = 21;
static const uint8_t LORA_RST = 18;
static const uint8_t LORA_DIO0 = 5;

static const uint32_t SEND_INTERVAL_MS = 3000;

LoraMesher& radio = LoraMesher::getInstance();

struct SmokePayload {
  uint32_t counter;
};

static bool radioStarted = false;
static bool radioStartReturned = false;
static uint32_t radioStartKickoffMs = 0;
static uint32_t lastSendMs = 0;
static uint32_t txCounter = 0;

void radioStartTask(void*) {
  LoraMesher::LoraMesherConfig config;
  config.loraCs = LORA_SS;
  config.loraRst = LORA_RST;
  config.loraIrq = LORA_DIO0;
  config.module = LoraMesher::LoraModules::RFM95_MOD;
  config.freq = 915.0;
  config.sf = 7;
  config.power = 17;

  Serial.printf("radio pins: cs=%u rst=%u dio0=%u\n", LORA_SS, LORA_RST, LORA_DIO0);
  Serial.println("radio task: begin()");
  radio.begin(config);
  Serial.println("radio task: start()");

  // Keep start in its own task so loop() can keep printing if startup hangs.
  radio.start();

  radioStarted = true;
  radioStartReturned = true;
  Serial.printf("radio task: started (localAddr=0x%X)\n", radio.getLocalAddress());
  vTaskDelete(nullptr);
}

void setupRadioAsync() {
  radioStartKickoffMs = millis();
  BaseType_t rc = xTaskCreate(radioStartTask, "radioStart", 8192, nullptr, 1, nullptr);
  if (rc != pdPASS) {
    Serial.printf("radio task: create failed (%d)\n", static_cast<int>(rc));
  } else {
    Serial.println("radio task: created");
  }
}

void setup() {
  Serial.begin(115200);

  uint32_t t0 = millis();
  while (!Serial && (millis() - t0 < 8000)) {
    delay(10);
  }

  Serial.println();
  Serial.println("boot: radio smoke test");
  setupRadioAsync();
}

void loop() {
  const uint32_t now = millis();

  if (!radioStarted && !radioStartReturned && (now - radioStartKickoffMs > 10000)) {
    Serial.println("alive: radio start still blocked (>10s)");
  } else {
    Serial.printf("alive: radio=%s\n", radioStarted ? "on" : "off");
  }

  if (radioStarted && (now - lastSendMs >= SEND_INTERVAL_MS)) {
    SmokePayload msg{txCounter++};
    radio.createPacketAndSend(BROADCAST_ADDR, &msg, 1);
    Serial.printf("tx: broadcast counter=%lu\n", static_cast<unsigned long>(msg.counter));
    lastSendMs = now;
  }

  delay(500);
}
