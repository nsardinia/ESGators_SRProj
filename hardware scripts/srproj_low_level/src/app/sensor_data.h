#pragma once

#include <Arduino.h>

namespace srproj {

static const uint8_t SENSOR_FLAG_SHT30_VALID = 0x01;
static const uint8_t SENSOR_FLAG_NO2_VALID = 0x02;
static const uint8_t SENSOR_FLAG_SOUND_VALID = 0x04;

struct SensorSnapshot {
  uint32_t updatedAtMs;
  uint8_t flags;
  float temperatureC;
  float humidityPct;
  uint16_t no2Raw;
  uint16_t no2MilliVolts;
  uint16_t soundRaw;
  uint16_t soundMilliVolts;
};

void initSensorSubsystem();
bool getLatestSensorSnapshot(SensorSnapshot& out);

}  // namespace srproj
