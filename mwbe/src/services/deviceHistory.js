"use strict";

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_SNAPSHOT_AGE_MS = 30_000;
const DEFAULT_HISTORY_LIMIT = 360;
const MAX_HISTORY_LIMIT = 2_000;

const SENSOR_DEFINITIONS = [
  {
    key: "no2",
    aliases: ["no2", "nitrogendioxide", "nitrogendioxide"],
  },
  {
    key: "sound_level",
    aliases: ["soundlevel", "soundleveldb", "sound_level", "noise", "db", "decibel"],
  },
  {
    key: "particulate_matter_level",
    aliases: [
      "particulatematterlevel",
      "particulatematterlevel",
      "particulate_matter_level",
      "particulatematter",
      "particulate_matter",
      "pm",
      "pm25",
      "pm2_5",
    ],
  },
  {
    key: "temperature",
    aliases: ["temperature", "temp"],
  },
  {
    key: "humidity",
    aliases: ["humidity", "humid"],
  },
];

const TIMESTAMP_KEY_NAMES = new Set([
  "updatedatms",
  "eventatms",
  "timestampms",
  "recordedatms",
  "createdatms",
  "updatedat",
  "eventat",
  "timestamp",
  "recordedat",
  "createdat",
]);

function normalizeLookupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parseNumericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1_000_000_000_000) {
      return value;
    }

    if (value > 1_000_000_000) {
      return value * 1_000;
    }
  }

  if (typeof value === "string" && value.trim() !== "") {
    const numericValue = Number(value);

    if (Number.isFinite(numericValue)) {
      return parseTimestampMs(numericValue);
    }

    const parsedValue = Date.parse(value);

    if (!Number.isNaN(parsedValue)) {
      return parsedValue;
    }
  }

  return null;
}

function collectLeafValues(value, path = [], acc = [], seen = new Set()) {
  if (!value || typeof value !== "object") {
    return acc;
  }

  if (seen.has(value)) {
    return acc;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((child, index) => {
      collectLeafValues(child, path.concat(String(index)), acc, seen);
    });
    return acc;
  }

  Object.entries(value).forEach(([key, child]) => {
    const nextPath = path.concat(key);
    const numericValue = parseNumericValue(child);

    if (numericValue !== null) {
      acc.push({
        key,
        normalizedKey: normalizeLookupKey(key),
        normalizedPath: nextPath.map(normalizeLookupKey),
        value: numericValue,
      });
      return;
    }

    collectLeafValues(child, nextPath, acc, seen);
  });

  return acc;
}

function collectTimestampCandidates(value, acc = [], seen = new Set()) {
  if (!value || typeof value !== "object") {
    return acc;
  }

  if (seen.has(value)) {
    return acc;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((child) => collectTimestampCandidates(child, acc, seen));
    return acc;
  }

  Object.entries(value).forEach(([key, child]) => {
    const normalizedKey = normalizeLookupKey(key);

    if (TIMESTAMP_KEY_NAMES.has(normalizedKey)) {
      const parsedTimestamp = parseTimestampMs(child);

      if (parsedTimestamp !== null) {
        acc.push(parsedTimestamp);
      }
    }

    if (child && typeof child === "object") {
      collectTimestampCandidates(child, acc, seen);
    }
  });

  return acc;
}

function scoreCandidate(candidate, aliases) {
  let score = 0;

  aliases.forEach((alias) => {
    if (candidate.normalizedKey === alias) {
      score = Math.max(score, 100);
    }

    if (candidate.normalizedPath.includes(alias)) {
      score = Math.max(score, 80);
    }

    if (candidate.normalizedKey.includes(alias) || alias.includes(candidate.normalizedKey)) {
      score = Math.max(score, 60);
    }
  });

  return score;
}

function pickSensorValues(payload) {
  const candidates = collectLeafValues(payload);
  const sensorValues = {};

  SENSOR_DEFINITIONS.forEach((sensor) => {
    let bestScore = 0;
    let bestValue = null;

    candidates.forEach((candidate) => {
      const score = scoreCandidate(candidate, sensor.aliases);

      if (score > bestScore) {
        bestScore = score;
        bestValue = candidate.value;
      }
    });

    sensorValues[sensor.key] = bestValue;
  });

  return sensorValues;
}

function floorToInterval(timestampMs, intervalMs) {
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

function isFreshSnapshot(sourceUpdatedAtMs, capturedAtMs, maxSnapshotAgeMs) {
  if (!Number.isFinite(sourceUpdatedAtMs) || !Number.isFinite(capturedAtMs)) {
    return false;
  }

  if (!Number.isFinite(maxSnapshotAgeMs) || maxSnapshotAgeMs < 0) {
    return true;
  }

  return capturedAtMs - sourceUpdatedAtMs <= maxSnapshotAgeMs;
}

function normalizeTelemetrySnapshot({
  deviceId,
  ownerUid,
  ownerFirebaseUid = null,
  payload,
  capturedAt = new Date(),
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxSnapshotAgeMs = DEFAULT_MAX_SNAPSHOT_AGE_MS,
}) {
  const sensorValues = pickSensorValues(payload);
  const hasAnySensorValue = Object.values(sensorValues).some((value) => value !== null);

  if (!hasAnySensorValue) {
    return null;
  }

  const capturedAtDate = capturedAt instanceof Date ? capturedAt : new Date(capturedAt);
  const capturedAtMs = capturedAtDate.getTime();
  const timestampCandidates = collectTimestampCandidates(payload);
  const sourceUpdatedAtMs =
    timestampCandidates.length > 0 ? Math.max(...timestampCandidates) : capturedAtMs;

  if (!isFreshSnapshot(sourceUpdatedAtMs, capturedAtMs, maxSnapshotAgeMs)) {
    return null;
  }

  const sampleIntervalStartMs = floorToInterval(sourceUpdatedAtMs, intervalMs);
  const sampleIntervalStart = new Date(sampleIntervalStartMs).toISOString();

  return {
    sample_key: `${deviceId}:${sampleIntervalStart}`,
    device_id: deviceId,
    owner_uid: ownerUid,
    owner_firebase_uid: ownerFirebaseUid,
    captured_at: capturedAtDate.toISOString(),
    source_updated_at: new Date(sourceUpdatedAtMs).toISOString(),
    sample_interval_start: sampleIntervalStart,
    no2: sensorValues.no2,
    sound_level: sensorValues.sound_level,
    particulate_matter_level: sensorValues.particulate_matter_level,
    temperature: sensorValues.temperature,
    humidity: sensorValues.humidity,
    raw_payload: payload,
  };
}

async function loadOwnerMap(app, ownerKeys) {
  const owners = new Map();
  const uniqueOwnerKeys = [...new Set(ownerKeys.filter(Boolean))];

  if (uniqueOwnerKeys.length === 0) {
    return owners;
  }

  const uuidOwnerKeys = uniqueOwnerKeys.filter((ownerKey) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(ownerKey || "")
    )
  );

  if (uuidOwnerKeys.length > 0) {
    const { data, error } = await app.supabase
      .from("users")
      .select("id, firebase_uid")
      .in("id", uuidOwnerKeys);

    if (error && error.code !== "22P02") {
      throw error;
    }

    (data || []).forEach((owner) => {
      owners.set(owner.id, owner);

      if (owner.firebase_uid) {
        owners.set(owner.firebase_uid, owner);
      }
    });
  }

  const firebaseOwnerKeys = uniqueOwnerKeys.filter((ownerKey) => !owners.has(ownerKey));

  if (firebaseOwnerKeys.length > 0) {
    const { data, error } = await app.supabase
      .from("users")
      .select("id, firebase_uid")
      .in("firebase_uid", firebaseOwnerKeys);

    if (error) {
      throw error;
    }

    (data || []).forEach((owner) => {
      owners.set(owner.id, owner);

      if (owner.firebase_uid) {
        owners.set(owner.firebase_uid, owner);
      }
    });
  }

  return owners;
}

async function syncDeviceHistoryOnce(app, options = {}) {
  if (!app.hasDecorator("supabase") || !app.hasDecorator("firebaseDb")) {
    return {
      syncedSamples: 0,
      processedDevices: 0,
      skippedDevices: 0,
    };
  }

  const intervalMs = Number(options.intervalMs || DEFAULT_POLL_INTERVAL_MS);
  const maxSnapshotAgeMs = Number(
    options.maxSnapshotAgeMs ?? process.env.DEVICE_HISTORY_MAX_SNAPSHOT_AGE_MS ?? DEFAULT_MAX_SNAPSHOT_AGE_MS
  );
  const capturedAt = options.capturedAt || new Date();

  const { data: devices, error: devicesError } = await app.supabase
    .from("devices")
    .select("device_id, owner_uid, status")
    .eq("status", "active");

  if (devicesError) {
    throw devicesError;
  }

  const ownersByKey = await loadOwnerMap(
    app,
    (devices || []).map((device) => device.owner_uid)
  );

  const rows = [];
  let skippedDevices = 0;

  for (const device of devices || []) {
    const owner = ownersByKey.get(device.owner_uid);

    if (!owner?.firebase_uid) {
      skippedDevices += 1;
      continue;
    }

    const snapshot = await app.firebaseDb
      .ref(`users/${owner.firebase_uid}/devices/${device.device_id}`)
      .get();

    if (!snapshot.exists()) {
      skippedDevices += 1;
      continue;
    }

    const normalizedRow = normalizeTelemetrySnapshot({
      deviceId: device.device_id,
      ownerUid: owner.firebase_uid || owner.id,
      ownerFirebaseUid: owner.firebase_uid || null,
      payload: snapshot.val(),
      capturedAt,
      intervalMs,
      maxSnapshotAgeMs,
    });

    if (!normalizedRow) {
      skippedDevices += 1;
      continue;
    }

    rows.push(normalizedRow);
  }

  if (rows.length > 0) {
    const { error } = await app.supabase
      .from("device_history")
      .upsert(rows, { onConflict: "sample_key" });

    if (error) {
      throw error;
    }
  }

  return {
    syncedSamples: rows.length,
    processedDevices: (devices || []).length,
    skippedDevices,
  };
}

function registerDeviceHistory(app) {
  const pollIntervalMs = Number(
    process.env.DEVICE_HISTORY_POLL_INTERVAL_MS || DEFAULT_POLL_INTERVAL_MS
  );
  const syncEnabled = process.env.DEVICE_HISTORY_SYNC_ENABLED !== "false";
  let timer = null;
  let syncInFlight = null;

  async function runSync() {
    if (!syncEnabled || syncInFlight) {
      return syncInFlight;
    }

    syncInFlight = syncDeviceHistoryOnce(app, { intervalMs: pollIntervalMs })
      .then((result) => {
        app.log.info({ result }, "Device history sync completed");
        return result;
      })
      .catch((error) => {
        app.log.error({ error }, "Device history sync failed");
        throw error;
      })
      .finally(() => {
        syncInFlight = null;
      });

    return syncInFlight;
  }

  app.decorate("deviceHistory", {
    syncOnce: runSync,
  });

  app.addHook("onReady", async () => {
    if (!syncEnabled) {
      app.log.info("Device history sync is disabled");
      return;
    }

    if (!app.hasDecorator("supabase") || !app.hasDecorator("firebaseDb")) {
      app.log.warn(
        "Device history sync is disabled because Supabase or Firebase Realtime Database is not configured"
      );
      return;
    }

    await runSync().catch(() => {});
    timer = setInterval(() => {
      runSync().catch(() => {});
    }, pollIntervalMs);
  });

  app.addHook("onClose", async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}

function clampHistoryLimit(value) {
  const numericValue = Number(value || DEFAULT_HISTORY_LIMIT);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }

  return Math.min(Math.trunc(numericValue), MAX_HISTORY_LIMIT);
}

module.exports = registerDeviceHistory;
module.exports.constants = {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_MAX_SNAPSHOT_AGE_MS,
  DEFAULT_POLL_INTERVAL_MS,
  MAX_HISTORY_LIMIT,
};
module.exports.helpers = {
  isFreshSnapshot,
  clampHistoryLimit,
  normalizeTelemetrySnapshot,
  syncDeviceHistoryOnce,
};
