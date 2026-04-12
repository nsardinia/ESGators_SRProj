#include "sensor_data.h"

#include <Arduino.h>
#include <Wire.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace srproj {

namespace {

static const uint8_t SHT30_ADDRESS = 0x44;
static const uint16_t SHT30_MEASURE_HIGH_REPEATABILITY = 0x2C06;
static const uint32_t SENSOR_SAMPLE_INTERVAL_MS = 1000;
static const uint32_t SENSOR_TASK_STACK_BYTES = 4096;
static const uint8_t SHT30_SDA_PIN = A4;
static const uint8_t SHT30_SCL_PIN = A5;
static const uint8_t NO2_PIN = A7;
static const uint8_t SOUND_PIN = A1;

TwoWire& sensorWire = Wire;
SemaphoreHandle_t sensorMutex = nullptr;
TaskHandle_t sensorTaskHandle = nullptr;
SensorSnapshot latestSnapshot = {};

uint8_t crc8Sht30(const uint8_t* data, size_t length) {
  uint8_t crc = 0xFF;
  for (size_t i = 0; i < length; ++i) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; ++bit) {
      const bool msbSet = (crc & 0x80U) != 0U;
      crc <<= 1;
      if (msbSet) crc ^= 0x31U;
    }
  }
  return crc;
}

bool readSht30(float& temperatureC, float& humidityPct) {
  sensorWire.beginTransmission(SHT30_ADDRESS);
  sensorWire.write(static_cast<uint8_t>(SHT30_MEASURE_HIGH_REPEATABILITY >> 8));
  sensorWire.write(static_cast<uint8_t>(SHT30_MEASURE_HIGH_REPEATABILITY & 0xFFU));
  if (sensorWire.endTransmission() != 0) {
    return false;
  }

  vTaskDelay(pdMS_TO_TICKS(20));

  constexpr uint8_t frameSize = 6;
  if (sensorWire.requestFrom(static_cast<int>(SHT30_ADDRESS), static_cast<int>(frameSize)) != frameSize) {
    while (sensorWire.available() > 0) sensorWire.read();
    return false;
  }

  uint8_t frame[frameSize] = {0};
  for (uint8_t i = 0; i < frameSize; ++i) {
    frame[i] = static_cast<uint8_t>(sensorWire.read());
  }

  if (crc8Sht30(frame, 2) != frame[2] || crc8Sht30(frame + 3, 2) != frame[5]) {
    return false;
  }

  const uint16_t rawTemp = (static_cast<uint16_t>(frame[0]) << 8) | frame[1];
  const uint16_t rawHumidity = (static_cast<uint16_t>(frame[3]) << 8) | frame[4];
  temperatureC = -45.0f + (175.0f * static_cast<float>(rawTemp) / 65535.0f);
  humidityPct = 100.0f * static_cast<float>(rawHumidity) / 65535.0f;
  return true;
}

void storeSnapshot(const SensorSnapshot& snapshot) {
  if (sensorMutex == nullptr) return;
  if (xSemaphoreTake(sensorMutex, portMAX_DELAY) != pdTRUE) return;
  latestSnapshot = snapshot;
  xSemaphoreGive(sensorMutex);
}

void logSnapshot(const SensorSnapshot& snapshot) {
  Serial.printf("sensor ms=%lu", static_cast<unsigned long>(snapshot.updatedAtMs));

  if ((snapshot.flags & SENSOR_FLAG_SHT30_VALID) != 0U) {
    Serial.printf(" temp=%.2fC humidity=%.2f%%", snapshot.temperatureC, snapshot.humidityPct);
  } else {
    Serial.print(" temp=NA humidity=NA");
  }

  if ((snapshot.flags & SENSOR_FLAG_NO2_VALID) != 0U) {
    Serial.printf(" no2Raw=%u no2mV=%u",
                  static_cast<unsigned int>(snapshot.no2Raw),
                  static_cast<unsigned int>(snapshot.no2MilliVolts));
  } else {
    Serial.print(" no2Raw=NA no2mV=NA");
  }

  if ((snapshot.flags & SENSOR_FLAG_SOUND_VALID) != 0U) {
    Serial.printf(" soundRaw=%u soundmV=%u",
                  static_cast<unsigned int>(snapshot.soundRaw),
                  static_cast<unsigned int>(snapshot.soundMilliVolts));
  } else {
    Serial.print(" soundRaw=NA soundmV=NA");
  }

  Serial.println();
}

void sensorTask(void*) {
  SensorSnapshot snapshot = {};

  for (;;) {
    snapshot.updatedAtMs = millis();
    snapshot.flags = 0;

    float temperatureC = 0.0f;
    float humidityPct = 0.0f;
    if (readSht30(temperatureC, humidityPct)) {
      snapshot.temperatureC = temperatureC;
      snapshot.humidityPct = humidityPct;
      snapshot.flags |= SENSOR_FLAG_SHT30_VALID;
    }

    snapshot.no2Raw = static_cast<uint16_t>(analogRead(NO2_PIN));
    snapshot.no2MilliVolts = static_cast<uint16_t>(analogReadMilliVolts(NO2_PIN));
    snapshot.flags |= SENSOR_FLAG_NO2_VALID;

    snapshot.soundRaw = static_cast<uint16_t>(analogRead(SOUND_PIN));
    snapshot.soundMilliVolts = static_cast<uint16_t>(analogReadMilliVolts(SOUND_PIN));
    snapshot.flags |= SENSOR_FLAG_SOUND_VALID;

    storeSnapshot(snapshot);
    logSnapshot(snapshot);
    vTaskDelay(pdMS_TO_TICKS(SENSOR_SAMPLE_INTERVAL_MS));
  }
}

}  // namespace

void initSensorSubsystem() {
  sensorMutex = xSemaphoreCreateMutex();
  if (sensorMutex == nullptr) {
    Serial.println("Failed to create sensor mutex");
    return;
  }

  sensorWire.begin(SHT30_SDA_PIN, SHT30_SCL_PIN);
  sensorWire.setClock(100000);

  analogReadResolution(12);
#if defined(ARDUINO_ARCH_ESP32)
  analogSetPinAttenuation(NO2_PIN, ADC_11db);
  analogSetPinAttenuation(SOUND_PIN, ADC_11db);
#endif

  BaseType_t taskRc = xTaskCreate(sensorTask, "SNSR", SENSOR_TASK_STACK_BYTES, nullptr, 2, &sensorTaskHandle);
  if (taskRc != pdPASS) {
    Serial.printf("Failed to create sensor task (err=%d)\n", static_cast<int>(taskRc));
  }
}

bool getLatestSensorSnapshot(SensorSnapshot& out) {
  if (sensorMutex == nullptr) return false;
  if (xSemaphoreTake(sensorMutex, pdMS_TO_TICKS(25)) != pdTRUE) return false;
  out = latestSnapshot;
  xSemaphoreGive(sensorMutex);
  return out.updatedAtMs != 0;
}

}  // namespace srproj
