const path = require("node:path");
const dotenv = require("dotenv");

const argv = process.argv.slice(2);

function parseArgs(args) {
  const parsed = {};

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (!token.startsWith("--")) {
      continue;
    }

    if (token.includes("=")) {
      const [rawKey, ...rest] = token.slice(2).split("=");
      parsed[rawKey] = rest.join("=");
      continue;
    }

    const key = token.slice(2);
    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

const cli = parseArgs(argv);

function loadEnvFile() {
  const explicitEnvFile = cli["env-file"] || process.env.DUMMY_DEVICE_ENV_FILE;
  const envFilePath = explicitEnvFile
    ? path.resolve(process.cwd(), String(explicitEnvFile))
    : path.resolve(process.cwd(), ".env.dummy-device");

  dotenv.config({ path: envFilePath });

  if (!explicitEnvFile) {
    dotenv.config();
  }
}

loadEnvFile();

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function resolveRequiredValue(cliKey, envKey) {
  const value = cli[cliKey] || process.env[envKey];

  if (!value) {
    throw new Error(`Missing required value: --${cliKey} or ${envKey}`);
  }

  return String(value).trim();
}

function normalizeBaseUrl(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildFetchOptions({ method = "GET", headers = {}, body } = {}) {
  return {
    method,
    headers,
    ...(body ? { body } : {}),
  };
}

function jitter(amplitude) {
  return (Math.random() * amplitude * 2) - amplitude;
}

function toFixedNumber(value, digits = 2) {
  return Number(value.toFixed(digits));
}

const CONFIG = {
  backendBaseUrl: normalizeBaseUrl(
    cli["backend-url"] || process.env.DUMMY_DEVICE_BACKEND_BASE_URL || "http://localhost:3000"
  ),
  firebaseApiKey: resolveRequiredValue("firebase-api-key", "DUMMY_DEVICE_FIREBASE_API_KEY"),
  firebaseDatabaseUrl: normalizeBaseUrl(
    resolveRequiredValue("firebase-db-url", "DUMMY_DEVICE_FIREBASE_DATABASE_URL")
  ),
  deviceId: resolveRequiredValue("device-id", "DUMMY_DEVICE_ID"),
  deviceSecret: resolveRequiredValue("device-secret", "DUMMY_DEVICE_SECRET"),
  intervalMs: Math.max(
    250,
    toNumber(cli.interval, toNumber(process.env.DUMMY_DEVICE_INTERVAL_MS, 1000))
  ),
  profile: String(cli.profile || process.env.DUMMY_DEVICE_PROFILE || "full").toLowerCase(),
  logRawResponses: cli["log-responses"] === true || process.env.DUMMY_DEVICE_LOG_RESPONSES === "true",
};

if (!["full", "basic"].includes(CONFIG.profile)) {
  throw new Error(`Unsupported profile "${CONFIG.profile}". Use "full" or "basic".`);
}

const state = {
  startedAtMs: Date.now(),
  iteration: 0,
  firebaseCustomToken: "",
  firebaseIdToken: "",
  firebaseRefreshToken: "",
  firebaseUid: "",
  ownerFirebaseUid: "",
  firebaseDevicePath: "",
  idTokenExpiresAtMs: 0,
};

async function parseJsonResponse(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function provisionDevice() {
  const endpoint = `${CONFIG.backendBaseUrl}/devices/provision`;
  const response = await fetch(
    endpoint,
    buildFetchOptions({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        deviceId: CONFIG.deviceId,
        deviceSecret: CONFIG.deviceSecret,
      }),
    })
  );
  const payload = await parseJsonResponse(response);

  if (CONFIG.logRawResponses) {
    console.log("Provision response:", payload);
  }

  if (!response.ok) {
    throw new Error(
      `Provision failed (${response.status}): ${payload.message || JSON.stringify(payload)}`
    );
  }

  state.firebaseCustomToken = String(payload.firebaseCustomToken || "");
  state.firebaseUid = String(payload.firebaseUid || "");
  state.ownerFirebaseUid = String(payload.ownerFirebaseUid || "");
  state.firebaseDevicePath = String(payload.firebaseDevicePath || "");

  if (!state.firebaseCustomToken || !state.firebaseDevicePath) {
    throw new Error("Provision response did not include the Firebase custom token or device path");
  }
}

async function signInWithCustomToken() {
  const endpoint =
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(
      CONFIG.firebaseApiKey
    )}`;
  const response = await fetch(
    endpoint,
    buildFetchOptions({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token: state.firebaseCustomToken,
        returnSecureToken: true,
      }),
    })
  );
  const payload = await parseJsonResponse(response);

  if (CONFIG.logRawResponses) {
    console.log("signInWithCustomToken response:", payload);
  }

  if (!response.ok) {
    throw new Error(
      `Firebase sign-in failed (${response.status}): ${payload.error?.message || JSON.stringify(payload)}`
    );
  }

  state.firebaseIdToken = String(payload.idToken || "");
  state.firebaseRefreshToken = String(payload.refreshToken || "");
  state.idTokenExpiresAtMs =
    Date.now() + (toNumber(payload.expiresIn, 3600) * 1000);
}

async function refreshIdToken() {
  const endpoint =
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(CONFIG.firebaseApiKey)}`;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: state.firebaseRefreshToken,
  });
  const response = await fetch(
    endpoint,
    buildFetchOptions({
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    })
  );
  const payload = await parseJsonResponse(response);

  if (CONFIG.logRawResponses) {
    console.log("refresh token response:", payload);
  }

  if (!response.ok) {
    throw new Error(
      `Firebase token refresh failed (${response.status}): ${payload.error?.message || JSON.stringify(payload)}`
    );
  }

  state.firebaseIdToken = String(payload.id_token || "");
  state.firebaseRefreshToken = String(payload.refresh_token || state.firebaseRefreshToken);
  state.idTokenExpiresAtMs =
    Date.now() + (toNumber(payload.expires_in, 3600) * 1000);
}

async function ensureFirebaseTokenReady() {
  if (!state.firebaseIdToken || !state.firebaseRefreshToken) {
    await signInWithCustomToken();
    return;
  }

  if (Date.now() < state.idTokenExpiresAtMs - 60_000) {
    return;
  }

  await refreshIdToken();
}

function buildSensorSnapshot() {
  const uptimeMs = Date.now() - state.startedAtMs;
  const cycle = state.iteration;
  const baseTemperature = CONFIG.profile === "full" ? 23.4 : 22.8;
  const baseHumidity = CONFIG.profile === "full" ? 49.5 : 52.5;
  const baseNo2 = CONFIG.profile === "full" ? 17.5 : 11.2;
  const baseSound = CONFIG.profile === "full" ? 58 : 52;
  const basePm = 12.8;

  const temperature = toFixedNumber(baseTemperature + Math.sin(cycle / 12) * 1.8 + jitter(0.15));
  const humidity = toFixedNumber(baseHumidity + Math.cos(cycle / 10) * 4.2 + jitter(0.3));
  const no2 = toFixedNumber(baseNo2 + Math.sin(cycle / 8) * 2.8 + jitter(0.2));
  const soundLevel = toFixedNumber(baseSound + Math.sin(cycle / 5) * 6.5 + jitter(0.5));
  const particulateMatterLevel =
    CONFIG.profile === "full"
      ? toFixedNumber(basePm + Math.cos(cycle / 7) * 3.4 + jitter(0.25))
      : null;
  const batteryVolts = toFixedNumber(4.08 - ((cycle % 240) * 0.0015), 3);
  const updatedAtMs = Date.now();

  return {
    uptimeMs,
    updatedAtMs,
    no2,
    soundLevel,
    particulateMatterLevel,
    temperature,
    humidity,
    batteryVolts,
  };
}

function buildRealtimePayload() {
  const sample = buildSensorSnapshot();

  return {
    deviceId: CONFIG.deviceId,
    firebaseUid: state.firebaseUid,
    ownerFirebaseUid: state.ownerFirebaseUid,
    profile: CONFIG.profile,
    status: "online",
    updatedAtMs: sample.updatedAtMs,
    uptimeMs: sample.uptimeMs,
    temperatureC: sample.temperature,
    humidityPct: sample.humidity,
    batteryVolts: sample.batteryVolts,
    latest: {
      status: "online",
      updatedAtMs: sample.updatedAtMs,
      no2: sample.no2,
      soundLevel: sample.soundLevel,
      particulateMatterLevel: sample.particulateMatterLevel,
      temperature: sample.temperature,
      humidity: sample.humidity,
    },
    telemetry: {
      readings: {
        latest: {
          status: "online",
          updatedAtMs: sample.updatedAtMs,
          no2: sample.no2,
          soundLevel: sample.soundLevel,
          particulateMatterLevel: sample.particulateMatterLevel,
          temperature: sample.temperature,
          humidity: sample.humidity,
        },
      },
    },
    gatewayReadings: {
      latest: {
        status: "online",
        updatedAtMs: sample.updatedAtMs,
        no2: sample.no2,
        sound_level: sample.soundLevel,
        particulate_matter_level: sample.particulateMatterLevel,
        temperature: sample.temperature,
        humidity: sample.humidity,
      },
    },
  };
}

async function publishOnce() {
  await ensureFirebaseTokenReady();

  const payload = buildRealtimePayload();
  const endpoint =
    `${CONFIG.firebaseDatabaseUrl}${state.firebaseDevicePath}.json?auth=${encodeURIComponent(
      state.firebaseIdToken
    )}`;
  const response = await fetch(
    endpoint,
    buildFetchOptions({
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })
  );
  const responsePayload = await parseJsonResponse(response);

  if (CONFIG.logRawResponses) {
    console.log("Firebase write response:", responsePayload);
  }

  if (response.status === 401 || response.status === 403) {
    await refreshIdToken();
    return publishOnce();
  }

  if (!response.ok) {
    throw new Error(
      `Firebase write failed (${response.status}): ${responsePayload.error || JSON.stringify(responsePayload)}`
    );
  }

  console.log(
    `[${new Date(payload.updatedAtMs).toISOString()}] published ${CONFIG.profile} sample for ${CONFIG.deviceId} | temp=${payload.temperatureC}C humidity=${payload.humidityPct}% no2=${payload.latest.no2} sound=${payload.latest.soundLevel}${payload.latest.particulateMatterLevel === null ? "" : ` pm=${payload.latest.particulateMatterLevel}`}`
  );
}

async function run() {
  console.log(`Provisioning ${CONFIG.deviceId} against ${CONFIG.backendBaseUrl}`);
  await provisionDevice();
  await signInWithCustomToken();

  console.log(`Connected as ${state.firebaseUid}`);
  console.log(`Writing to ${state.firebaseDevicePath} every ${CONFIG.intervalMs}ms`);

  while (true) {
    state.iteration += 1;

    try {
      await publishOnce();
    } catch (error) {
      console.error("Publish error:", error.message);
    }

    await delay(CONFIG.intervalMs);
  }
}

run().catch((error) => {
  console.error("Fatal error:", error.message);
  process.exit(1);
});
