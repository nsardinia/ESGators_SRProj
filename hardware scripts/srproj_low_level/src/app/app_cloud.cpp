#include "app_internal.h"

namespace srproj {

bool isHttpsUrl(const String& url) {
  return url.startsWith("https://");
}

void configureHttpClient(HTTPClient& http) {
  http.addHeader("Content-Type", "application/json");
  http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
  http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
}

String urlEncode(const String& input) {
  const char* hex = "0123456789ABCDEF";
  String encoded;
  for (size_t i = 0; i < input.length(); i += 1) {
    const char current = input[i];
    const bool safeChar =
      (current >= 'a' && current <= 'z') ||
      (current >= 'A' && current <= 'Z') ||
      (current >= '0' && current <= '9') ||
      current == '-' || current == '_' || current == '.' || current == '~';
    if (safeChar) {
      encoded += current;
      continue;
    }
    encoded += '%';
    encoded += hex[(current >> 4) & 0x0F];
    encoded += hex[current & 0x0F];
  }
  return encoded;
}

void logFirebaseTaskVitals(const char* stage) {
  UBaseType_t stackWords = 0;
  if (firebaseTaskHandle != nullptr) stackWords = uxTaskGetStackHighWaterMark(firebaseTaskHandle);
  Serial.printf("Firebase dbg stage=%s heap=%u minHeap=%u stackHW=%u\n", stage,
                static_cast<unsigned int>(ESP.getFreeHeap()),
                static_cast<unsigned int>(ESP.getMinFreeHeap()),
                static_cast<unsigned int>(stackWords * sizeof(StackType_t)));
}

bool postJson(const String& url, const String& payload, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    configureHttpClient(http);
    statusCode = http.POST(payload);
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  configureHttpClient(http);
  statusCode = http.POST(payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool postForm(const String& url, const String& payload, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    http.addHeader("Content-Type", "application/x-www-form-urlencoded");
    http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
    http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
    statusCode = http.POST(payload);
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  http.addHeader("Content-Type", "application/x-www-form-urlencoded");
  http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
  http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
  statusCode = http.POST(payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool putJson(const String& url, const String& payload, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    configureHttpClient(http);
    statusCode = http.sendRequest("PUT", payload);
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  configureHttpClient(http);
  statusCode = http.sendRequest("PUT", payload);
  responseBody = http.getString();
  http.end();
  return true;
}

bool getJson(const String& url, int& statusCode, String& responseBody) {
  HTTPClient http;
  if (isHttpsUrl(url)) {
    WiFiClientSecure secureClient;
    if (ALLOW_INSECURE_TLS) secureClient.setInsecure();
    if (!http.begin(secureClient, url)) return false;
    http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
    http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
    statusCode = http.GET();
    responseBody = http.getString();
    http.end();
    return true;
  }
  WiFiClient client;
  if (!http.begin(client, url)) return false;
  http.setConnectTimeout(static_cast<int>(HTTP_CONNECT_TIMEOUT_MS));
  http.setTimeout(static_cast<int>(HTTP_TIMEOUT_MS));
  statusCode = http.GET();
  responseBody = http.getString();
  http.end();
  return true;
}

void kickWifiConnect() {
  const uint32_t now = millis();
  if (WiFi.status() == WL_CONNECTED || now - lastWifiAttemptMs < WIFI_RETRY_MS) return;
  const DeviceConfigState& cfg = getDeviceConfig();
  if (cfg.wifiSsid[0] == '\0') return;
  lastWifiAttemptMs = now;
  WiFi.disconnect();
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(cfg.wifiSsid, cfg.wifiPassword);
}

bool provisionDevice() {
  const DeviceConfigState& cfg = getDeviceConfig();
  const String endpoint = String(cfg.backendBaseUrl) + "/devices/provision";
  DynamicJsonDocument payloadDoc(256);
  payloadDoc["deviceId"] = cfg.deviceId;
  payloadDoc["deviceSecret"] = cfg.deviceSecret;

  String payload;
  serializeJson(payloadDoc, payload);

  int statusCode = -1;
  String responseBody;
  if (!postJson(endpoint, payload, statusCode, responseBody)) return false;
  if (statusCode < 200 || statusCode >= 300) return false;

  DynamicJsonDocument responseDoc(2048);
  if (deserializeJson(responseDoc, responseBody)) return false;

  firebaseCustomToken = String((const char*)(responseDoc["firebaseCustomToken"] | ""));
  firebaseUid = String((const char*)(responseDoc["firebaseUid"] | ""));
  provisionedDeviceId = String((const char*)(responseDoc["deviceId"] | ""));
  ownerFirebaseUid = String((const char*)(responseDoc["ownerFirebaseUid"] | ""));
  ownerFirebaseUid.trim();
  if (ownerFirebaseUid.isEmpty()) parseOwnerFirebaseUidFromDeviceSecret(cfg.deviceSecret, ownerFirebaseUid);
  if (firebaseCustomToken.isEmpty() || provisionedDeviceId.isEmpty() || ownerFirebaseUid.isEmpty()) return false;

  provisioned = true;
  return true;
}

bool signInToFirebaseWithCustomToken() {
  const DeviceConfigState& cfg = getDeviceConfig();
  const String endpoint =
    String("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=") + cfg.firebaseApiKey;

  DynamicJsonDocument payloadDoc(512);
  payloadDoc["token"] = firebaseCustomToken;
  payloadDoc["returnSecureToken"] = true;

  String payload;
  serializeJson(payloadDoc, payload);

  int statusCode = -1;
  String responseBody;
  if (!postJson(endpoint, payload, statusCode, responseBody)) return false;
  if (statusCode < 200 || statusCode >= 300) return false;

  DynamicJsonDocument responseDoc(3072);
  if (deserializeJson(responseDoc, responseBody)) return false;

  firebaseIdToken = String((const char*)(responseDoc["idToken"] | ""));
  firebaseRefreshToken = String((const char*)(responseDoc["refreshToken"] | ""));
  const uint32_t expiresInSeconds = String((const char*)(responseDoc["expiresIn"] | "3600")).toInt();
  if (firebaseIdToken.isEmpty() || firebaseRefreshToken.isEmpty()) return false;

  firebaseIdTokenExpiresAtMs = millis() + (expiresInSeconds * 1000UL);
  firebaseReady = true;
  return true;
}

bool refreshFirebaseIdToken() {
  if (firebaseRefreshToken.isEmpty()) return false;
  const String endpoint = String("https://securetoken.googleapis.com/v1/token?key=") + getDeviceConfig().firebaseApiKey;
  const String payload = "grant_type=refresh_token&refresh_token=" + urlEncode(firebaseRefreshToken);

  int statusCode = -1;
  String responseBody;
  if (!postForm(endpoint, payload, statusCode, responseBody)) return false;
  if (statusCode < 200 || statusCode >= 300) return false;

  DynamicJsonDocument responseDoc(2048);
  if (deserializeJson(responseDoc, responseBody)) return false;

  firebaseIdToken = String((const char*)(responseDoc["id_token"] | ""));
  firebaseRefreshToken = String((const char*)(responseDoc["refresh_token"] | ""));
  const uint32_t expiresInSeconds = String((const char*)(responseDoc["expires_in"] | "3600")).toInt();
  if (firebaseIdToken.isEmpty()) return false;

  firebaseIdTokenExpiresAtMs = millis() + (expiresInSeconds * 1000UL);
  return true;
}

bool ensureFirebaseReady() {
  if (!firebaseReady) return false;
  const uint32_t now = millis();
  if (firebaseIdTokenExpiresAtMs > now + 60000UL) return true;
  return refreshFirebaseIdToken();
}

bool writeJsonByPath(const String& dbPath, const String& payload) {
  if (!ensureFirebaseReady()) return false;
  const String url = String(getDeviceConfig().firebaseDatabaseUrl) + "/" + dbPath + ".json?auth=" + firebaseIdToken;

  int statusCode = -1;
  String responseBody;
  if (!putJson(url, payload, statusCode, responseBody)) return false;
  if (statusCode == 401) {
    if (refreshFirebaseIdToken()) return writeJsonByPath(dbPath, payload);
    return false;
  }
  return statusCode >= 200 && statusCode < 300;
}

bool readJsonByPath(const String& dbPath, String& responseBody) {
  if (!ensureFirebaseReady()) return false;
  const String url = String(getDeviceConfig().firebaseDatabaseUrl) + "/" + dbPath + ".json?auth=" + firebaseIdToken;

  int statusCode = -1;
  if (!getJson(url, statusCode, responseBody)) return false;
  if (statusCode == 401) {
    if (refreshFirebaseIdToken()) return readJsonByPath(dbPath, responseBody);
    return false;
  }
  return statusCode >= 200 && statusCode < 300;
}

bool refreshRadioNetworkConfigFromCloud(bool force) {
  const uint32_t now = millis();
  if (!force) {
    if (!radioConfigLoaded) {
    } else if (getNodeRole() != NodeRole::Gateway && localDeviceInRadioNetwork) {
      return true;
    } else if (now - lastCloudConfigFetchMs < CLOUD_CONFIG_REFRESH_MS) {
      return true;
    }
  }

  String configJson;
  logFirebaseTaskVitals("before_cfg_get");
  const String radioConfigPath = firebaseUserBasePath() + "/config/radio-network";
  if (radioConfigPath.isEmpty()) return false;
  if (!readJsonByPath(radioConfigPath, configJson)) return false;
  Serial.printf("Firebase dbg config bytes=%u\n", static_cast<unsigned int>(configJson.length()));
  logFirebaseTaskVitals("after_cfg_get");

  if (isFirebaseNodeMissingPayload(configJson)) {
    activateWifiDirectFallback("firebase_config_missing", "no radio-network config found");
    return true;
  }

  NetworkConfigState parsed = {};
  if (!parseNetworkConfigJson(configJson, parsed)) return false;
  logFirebaseTaskVitals("after_cfg_parse");

  desiredConfig = parsed;
  const NodeConfigEntry* localCfg = getLocalNodeConfigEntry();
  if (localCfg != nullptr) {
    NodeConfigEntry* mutableLocal = nullptr;
    if (textHasValue(localCfg->deviceId)) mutableLocal = findMutableNodeConfigByDeviceId(localCfg->deviceId);
    if (mutableLocal == nullptr && localCfg->nodeId != 0) mutableLocal = findMutableNodeConfigByNodeId(localCfg->nodeId);
    if (mutableLocal != nullptr) {
      mutableLocal->nodeId = thisNodeId();
      mutableLocal->lastKnownAddress = localAddr;
      mutableLocal->lastSeenMs = now;
    }
  }

  applyLocalNodeConfig("firebase_config");
  radioConfigLoaded = true;
  lastCloudConfigFetchMs = now;
  logFirebaseTaskVitals("after_cfg_apply");
  dumpDesiredConfig();
  return true;
}

bool shouldUseRadioNetwork() {
  return radioConfigLoaded && localDeviceInRadioNetwork;
}

bool shouldUploadDirectToFirebase() {
  return radioConfigLoaded && !localDeviceInRadioNetwork;
}

float decodeTemperatureC(const GatewayReading& msg) { return static_cast<float>(msg.temperatureCentiC) / 100.0f; }
float decodeHumidityPct(const GatewayReading& msg) { return static_cast<float>(msg.humidityCentiPct) / 100.0f; }

void appendSensorFields(JsonDocument& payloadDoc, const GatewayReading& msg) {
  payloadDoc["readingRaw"] = msg.readingRaw;
  payloadDoc["sensorFlags"] = msg.sensorFlags;
  payloadDoc["updatedAtMs"] = msg.eventAtMs;

  JsonObject sht30Latest = payloadDoc["sht30"].to<JsonObject>()["latest"].to<JsonObject>();
  sht30Latest["deviceId"] = msg.sourceDeviceId;
  sht30Latest["nodeId"] = msg.nodeId;
  sht30Latest["updatedAtMs"] = msg.eventAtMs;
  sht30Latest["status"] = (msg.sensorFlags & SENSOR_FLAG_SHT30_VALID) != 0U ? "ok" : "unavailable";
  if ((msg.sensorFlags & SENSOR_FLAG_SHT30_VALID) != 0U) {
    sht30Latest["temperatureC"] = decodeTemperatureC(msg);
    sht30Latest["humidityPct"] = decodeHumidityPct(msg);
    payloadDoc["temperatureC"] = decodeTemperatureC(msg);
    payloadDoc["humidityPct"] = decodeHumidityPct(msg);
  }

  JsonObject no2Latest = payloadDoc["no2"].to<JsonObject>()["latest"].to<JsonObject>();
  no2Latest["deviceId"] = msg.sourceDeviceId;
  no2Latest["nodeId"] = msg.nodeId;
  no2Latest["updatedAtMs"] = msg.eventAtMs;
  no2Latest["raw"] = msg.no2Raw;
  no2Latest["millivolts"] = msg.no2MilliVolts;
  no2Latest["unit"] = "adc_raw";

  JsonObject soundLatest = payloadDoc["sound"].to<JsonObject>()["latest"].to<JsonObject>();
  soundLatest["deviceId"] = msg.sourceDeviceId;
  soundLatest["nodeId"] = msg.nodeId;
  soundLatest["updatedAtMs"] = msg.eventAtMs;
  soundLatest["raw"] = msg.soundRaw;
  soundLatest["millivolts"] = msg.soundMilliVolts;
  soundLatest["unit"] = "adc_raw";
}

void appendAggregateLatest(JsonDocument& payloadDoc, const GatewayReading& msg) {
  payloadDoc["no2Raw"] = msg.no2Raw;
  payloadDoc["no2MilliVolts"] = msg.no2MilliVolts;
  payloadDoc["soundRaw"] = msg.soundRaw;
  payloadDoc["soundMilliVolts"] = msg.soundMilliVolts;
  if ((msg.sensorFlags & SENSOR_FLAG_SHT30_VALID) != 0U) {
    payloadDoc["temperatureC"] = decodeTemperatureC(msg);
    payloadDoc["humidityPct"] = decodeHumidityPct(msg);
  }
}

bool writeSensorBucketPayloads(const String& deviceBasePath, const GatewayReading& msg) {
  DynamicJsonDocument sht30Doc(256);
  JsonObject sht30Latest = sht30Doc.to<JsonObject>();
  sht30Latest["deviceId"] = msg.sourceDeviceId;
  sht30Latest["nodeId"] = msg.nodeId;
  sht30Latest["updatedAtMs"] = msg.eventAtMs;
  sht30Latest["status"] = (msg.sensorFlags & SENSOR_FLAG_SHT30_VALID) != 0U ? "ok" : "unavailable";
  if ((msg.sensorFlags & SENSOR_FLAG_SHT30_VALID) != 0U) {
    sht30Latest["temperatureC"] = decodeTemperatureC(msg);
    sht30Latest["humidityPct"] = decodeHumidityPct(msg);
  }
  String sht30Payload;
  serializeJson(sht30Doc, sht30Payload);
  if (!writeJsonByPath(deviceBasePath + "/sht30/latest", sht30Payload)) return false;

  DynamicJsonDocument no2Doc(256);
  JsonObject no2Latest = no2Doc.to<JsonObject>();
  no2Latest["deviceId"] = msg.sourceDeviceId;
  no2Latest["nodeId"] = msg.nodeId;
  no2Latest["updatedAtMs"] = msg.eventAtMs;
  no2Latest["raw"] = msg.no2Raw;
  no2Latest["millivolts"] = msg.no2MilliVolts;
  no2Latest["unit"] = "adc_raw";
  String no2Payload;
  serializeJson(no2Doc, no2Payload);
  if (!writeJsonByPath(deviceBasePath + "/no2/latest", no2Payload)) return false;

  DynamicJsonDocument soundDoc(256);
  JsonObject soundLatest = soundDoc.to<JsonObject>();
  soundLatest["deviceId"] = msg.sourceDeviceId;
  soundLatest["nodeId"] = msg.nodeId;
  soundLatest["updatedAtMs"] = msg.eventAtMs;
  soundLatest["raw"] = msg.soundRaw;
  soundLatest["millivolts"] = msg.soundMilliVolts;
  soundLatest["unit"] = "adc_raw";
  String soundPayload;
  serializeJson(soundDoc, soundPayload);
  if (!writeJsonByPath(deviceBasePath + "/sound/latest", soundPayload)) return false;

  return true;
}

bool uploadDirectReading(const GatewayReading& msg) {
  const String deviceBasePath = provisionedFirebaseDeviceBasePath();
  if (deviceBasePath.isEmpty()) return false;

  DynamicJsonDocument payloadDoc(1024);
  payloadDoc["deviceId"] = provisionedDeviceId;
  payloadDoc["ownerFirebaseUid"] = ownerFirebaseUid;
  payloadDoc["nodeId"] = thisNodeId();
  payloadDoc["type"] = "direct";
  payloadDoc["counter"] = msg.counter;
  payloadDoc["uptimeMs"] = msg.uptimeMs;
  payloadDoc["eventAtMs"] = msg.eventAtMs;
  appendAggregateLatest(payloadDoc, msg);
  appendSensorFields(payloadDoc, msg);

  String payload;
  serializeJson(payloadDoc, payload);

  const String latestPath = deviceBasePath + "/readings/latest";
  if (!writeJsonByPath(latestPath, payload)) return false;
  if (!writeJsonByPath(deviceBasePath + "/readings", payload)) return false;

  const String historyKey = String(msg.eventAtMs) + "_" + String(static_cast<unsigned long>(msg.counter));
  if (!writeJsonByPath(deviceBasePath + "/readings/history/" + historyKey, payload)) return false;
  return writeSensorBucketPayloads(deviceBasePath, msg);
}

bool uploadReadingEvent(const GatewayReading& msg) {
  if (shouldUploadDirectToFirebase()) return uploadDirectReading(msg);
  const String gatewayDeviceBasePath = provisionedFirebaseDeviceBasePath();
  if (gatewayDeviceBasePath.isEmpty()) return false;

  DynamicJsonDocument payloadDoc(1280);
  payloadDoc["deviceId"] = msg.sourceDeviceId;
  payloadDoc["gatewayDeviceId"] = provisionedDeviceId;
  payloadDoc["firebaseUid"] = firebaseUid;
  payloadDoc["ownerFirebaseUid"] = ownerFirebaseUid;
  payloadDoc["type"] = msg.isTx ? "tx" : "rx";
  payloadDoc["localAddr"] = msg.localAddr;
  payloadDoc["peerAddr"] = msg.peerAddr;
  payloadDoc["nodeId"] = msg.nodeId;
  payloadDoc["counter"] = msg.counter;
  payloadDoc["uptimeMs"] = msg.uptimeMs;
  payloadDoc["eventAtMs"] = msg.eventAtMs;
  appendAggregateLatest(payloadDoc, msg);
  appendSensorFields(payloadDoc, msg);

  String payload;
  serializeJson(payloadDoc, payload);

  if (!writeJsonByPath(gatewayDeviceBasePath + "/gatewayReadings/latest", payload)) return false;
  if (msg.isTx) return writeSensorBucketPayloads(gatewayDeviceBasePath, msg);

  String clientKey = strlen(msg.sourceDeviceId) > 0 ? String(msg.sourceDeviceId) : String("node_") + String(msg.nodeId);
  if (!writeJsonByPath(gatewayDeviceBasePath + "/clients/" + clientKey + "/readings/latest", payload)) return false;

  const String historyKey = String(msg.eventAtMs) + "_" + String(static_cast<unsigned long>(msg.counter));
  if (!writeJsonByPath(gatewayDeviceBasePath + "/clients/" + clientKey + "/readings/history/" + historyKey, payload)) return false;
  if (!writeJsonByPath(gatewayDeviceBasePath + "/" + clientKey + "/readings", payload)) return false;
  return writeSensorBucketPayloads(gatewayDeviceBasePath + "/clients/" + clientKey, msg);
}

bool uploadMeshStatusSnapshot(uint32_t now) {
  const String gatewayDeviceBasePath = provisionedFirebaseDeviceBasePath();
  if (gatewayDeviceBasePath.isEmpty() || !shouldUseRadioNetwork() || getNodeRole() != NodeRole::Gateway) return false;

  DynamicJsonDocument payloadDoc(6144);
  payloadDoc["gatewayNodeId"] = thisNodeId();
  payloadDoc["gatewayDeviceId"] = provisionedDeviceId;
  payloadDoc["ownerFirebaseUid"] = ownerFirebaseUid;
  payloadDoc["gatewayAddr"] = localAddr;
  payloadDoc["updatedAtMs"] = now;
  payloadDoc["configVersion"] = desiredConfig.version;
  payloadDoc["routingTableSize"] = radio.routingTableSize();
  payloadDoc["staleTimeoutMs"] = NODE_STALE_TIMEOUT_MS;

  JsonArray nodes = payloadDoc.createNestedArray("nodes");
  JsonArray paths = payloadDoc.createNestedArray("paths");
  for (size_t i = 0; i < desiredConfig.nodeCount; ++i) {
    const NodeConfigEntry& cfg = desiredConfig.nodes[i];
    const bool isLocalDevice = textHasValue(cfg.deviceId) && textEquals(cfg.deviceId, localDeviceId);
    const bool available = isLocalDevice || hasRecentNodeContact(cfg, now);
    const char* status = !cfg.enabled ? "disabled" : (available ? "up" : "down");

    uint16_t address = isLocalDevice ? localAddr : cfg.lastKnownAddress;
    if (address == 0 && cfg.nodeId != 0) lookupAddressByNodeId(cfg.nodeId, address);
    const RouteSnapshot route = findRouteSnapshotByAddress(address);
    uint8_t viaNodeId = 0;
    if (route.found && route.viaAddr != 0) lookupNodeIdByAddress(route.viaAddr, viaNodeId);

    appendMeshNodeStatus(nodes, cfg.deviceId, cfg.nodeId, address, status, meshRoleName(cfg.role),
                         route.found ? route.hops : 0, route.found ? route.viaAddr : 0, viaNodeId);

    JsonObject path = paths.add<JsonObject>();
    if (textHasValue(cfg.deviceId)) path["deviceId"] = cfg.deviceId;
    if (cfg.nodeId != 0) path["nodeId"] = cfg.nodeId;
    path["status"] = status;
    path["address"] = address;
    path["role"] = meshRoleName(cfg.role);
    if (route.found) {
      path["viaAddr"] = route.viaAddr;
      path["hops"] = route.hops;
      path["routeRole"] = routeRoleName(route.roleFlags);
      if (viaNodeId != 0) path["viaNodeId"] = viaNodeId;
    }
  }

  String payload;
  serializeJson(payloadDoc, payload);
  if (!writeJsonByPath(gatewayDeviceBasePath + "/networkStatus/latest", payload)) return false;
  return writeJsonByPath(gatewayDeviceBasePath + "/meshStatus/latest", payload);
}

void queueFirebaseUploadEvent(bool isTx, uint16_t peerAddr, const MeshPacketPayload& payload, uint32_t eventAtMs) {
  if (firebaseQueue == nullptr) return;
  if (getNodeRole() != NodeRole::Gateway && !shouldUploadDirectToFirebase()) return;

  GatewayReading event = {};
  event.isTx = isTx;
  event.localAddr = localAddr;
  event.peerAddr = peerAddr;
  event.nodeId = payload.nodeId;
  event.counter = payload.counter;
  event.uptimeMs = payload.uptimeMs;
  event.readingRaw = payload.readingRaw;
  event.sensorFlags = payload.sensorFlags;
  event.temperatureCentiC = payload.temperatureCentiC;
  event.humidityCentiPct = payload.humidityCentiPct;
  event.no2Raw = payload.no2Raw;
  event.no2MilliVolts = payload.no2MilliVolts;
  event.soundRaw = payload.soundRaw;
  event.soundMilliVolts = payload.soundMilliVolts;
  event.eventAtMs = eventAtMs;
  event.uploadRetries = 0;
  copyDeviceId(event.sourceDeviceId, sizeof(event.sourceDeviceId), payload.deviceId);
  if (xQueueSend(firebaseQueue, &event, 0) == pdTRUE) firebaseQueuedEvents++;
  else {
    firebaseFailedEvents++;
    Serial.println("Firebase queue full; dropped event");
  }
}

void firebaseUploaderTask(void*) {
  static const uint8_t MAX_UPLOAD_RETRIES = 4;
  for (;;) {
    kickWifiConnect();
    if (WiFi.status() != WL_CONNECTED) {
      const uint32_t now = millis();
      if (now - lastFirebaseDiagMs > 3000) {
        Serial.println("Firebase: waiting for WiFi");
        lastFirebaseDiagMs = now;
      }
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }

    if (!provisioned) {
      logFirebaseTaskVitals("before_provision");
      if (!provisionDevice()) {
        const uint32_t now = millis();
        if (now - lastFirebaseDiagMs > 3000) {
          Serial.println("Firebase: provision failed, retrying");
          lastFirebaseDiagMs = now;
        }
        vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
        continue;
      }
      Serial.println("Firebase: provisioned");
      logFirebaseTaskVitals("after_provision");
    }

    if (!firebaseReady) {
      logFirebaseTaskVitals("before_signin");
      if (!signInToFirebaseWithCustomToken()) {
        const uint32_t now = millis();
        if (now - lastFirebaseDiagMs > 3000) {
          Serial.println("Firebase: sign-in failed, retrying");
          lastFirebaseDiagMs = now;
        }
        vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
        continue;
      }
      Serial.println("Firebase: signed in");
      logFirebaseTaskVitals("after_signin");
    }

    if (!ensureFirebaseReady()) {
      firebaseReady = false;
      const uint32_t now = millis();
      if (now - lastFirebaseDiagMs > 3000) {
        Serial.println("Firebase: token refresh failed, retrying");
        lastFirebaseDiagMs = now;
      }
      vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
      continue;
    }

    if (!refreshRadioNetworkConfigFromCloud(false)) {
      const uint32_t now = millis();
      activateWifiDirectFallback("firebase_config_error", "radio-network config fetch failed");
      if (now - lastFirebaseDiagMs > 3000) {
        Serial.println("Firebase: radio-network config fetch failed, retrying");
        lastFirebaseDiagMs = now;
      }
    }

    if (!radioConfigLoaded) {
      vTaskDelay(pdMS_TO_TICKS(300));
      continue;
    }

    const uint32_t now = millis();
    if (getNodeRole() == NodeRole::Gateway && shouldUseRadioNetwork() &&
        now - lastMeshStatusPublishMs >= MESH_STATUS_PUBLISH_INTERVAL_MS &&
        uploadMeshStatusSnapshot(now)) {
      lastMeshStatusPublishMs = now;
    }

    if (getNodeRole() != NodeRole::Gateway && !shouldUploadDirectToFirebase()) {
      vTaskDelay(pdMS_TO_TICKS(400));
      continue;
    }

    GatewayReading pending;
    if (xQueueReceive(firebaseQueue, &pending, pdMS_TO_TICKS(250)) != pdTRUE) {
      vTaskDelay(pdMS_TO_TICKS(50));
      continue;
    }

    if (uploadReadingEvent(pending)) {
      firebaseUploadedEvents++;
      continue;
    }

    firebaseFailedEvents++;
    pending.uploadRetries++;
    if (pending.uploadRetries <= MAX_UPLOAD_RETRIES) xQueueSend(firebaseQueue, &pending, 0);
    vTaskDelay(pdMS_TO_TICKS(UPLOAD_RETRY_MS));
  }
}

}  // namespace srproj
