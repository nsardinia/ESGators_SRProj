#include <Arduino.h>
#include <LoRaMesher.h>

#include <cmath>

#include "app/radio_protocol.h"
#include "app/sensor_data.h"

// Simple one-board radio smoke test: start LoRaMesher and broadcast sensor packets.
// Use this to verify the radio on a suspect board can initialize and transmit the
// same packet shape the main app uses for mesh readings.

static const uint8_t LORA_SS = 21;
static const uint8_t LORA_RST = 18;
static const uint8_t LORA_DIO0 = 5;
static const uint8_t SMOKE_TEST_NODE_ID = 250;
static const uint16_t SMOKE_TEST_CONFIG_VERSION = 1;
static const char* SMOKE_TEST_DEVICE_ID = "radio_smoketest";

static const uint32_t SEND_INTERVAL_MS = 3000;

LoraMesher& radio = LoraMesher::getInstance();

static bool radioStarted = false;
static bool radioStartReturned = false;
static uint32_t radioStartKickoffMs = 0;
static uint32_t lastSendMs = 0;
static uint32_t txCounter = 0;

void copyDeviceId(char* dst, size_t dstLen, const char* src) {
  if (dstLen == 0) return;
  if (src == nullptr) {
    dst[0] = '\0';
    return;
  }

  strncpy(dst, src, dstLen - 1);
  dst[dstLen - 1] = '\0';
}

void logPacket(const srproj::MeshPacketPayload& msg) {
  Serial.printf(
    "tx: node=%u counter=%lu flags=0x%02X no2Raw=%u no2mV=%u soundRaw=%u soundmV=%u",
    static_cast<unsigned int>(msg.nodeId),
    static_cast<unsigned long>(msg.counter),
    static_cast<unsigned int>(msg.sensorFlags),
    static_cast<unsigned int>(msg.no2Raw),
    static_cast<unsigned int>(msg.no2MilliVolts),
    static_cast<unsigned int>(msg.soundRaw),
    static_cast<unsigned int>(msg.soundMilliVolts)
  );

  if ((msg.sensorFlags & srproj::SENSOR_FLAG_SHT30_VALID) != 0U) {
    Serial.printf(
      " temp=%.2fC humidity=%.2f%%",
      static_cast<float>(msg.temperatureCentiC) / 100.0f,
      static_cast<float>(msg.humidityCentiPct) / 100.0f
    );
  } else {
    Serial.print(" temp=NA humidity=NA");
  }

  Serial.println();
}

srproj::MeshPacketPayload buildSmokePayload(uint32_t now) {
  srproj::MeshPacketPayload payload = {};
  payload.msgType = static_cast<uint8_t>(srproj::MeshMsgType::Reading);
  payload.nodeId = SMOKE_TEST_NODE_ID;
  payload.configVersion = SMOKE_TEST_CONFIG_VERSION;
  payload.counter = txCounter++;
  payload.uptimeMs = now;
  copyDeviceId(payload.deviceId, sizeof(payload.deviceId), SMOKE_TEST_DEVICE_ID);

  srproj::SensorSnapshot snapshot = {};
  if (srproj::getLatestSensorSnapshot(snapshot)) {
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

  return payload;
}

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
  srproj::initSensorSubsystem();
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
    srproj::MeshPacketPayload msg = buildSmokePayload(now);
    radio.createPacketAndSend(BROADCAST_ADDR, &msg, 1);
    logPacket(msg);
    lastSendMs = now;
  }

  delay(500);
}
