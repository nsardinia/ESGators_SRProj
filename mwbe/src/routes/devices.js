/**
 * Fastify device provisioning endpoints.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

const crypto = require("node:crypto");
const {
  constants: { MAX_HISTORY_LIMIT },
  helpers: { clampHistoryLimit },
} = require("../services/deviceHistory");
const { verifyFirebaseUser } = require("../lib/firebaseUserAuth");

const claimQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const ownerQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const deleteDeviceQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const claimBodySchema = {
  type: "object",
  required: ["name", "description"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: { type: "string", minLength: 1, maxLength: 500 },
  },
};

const provisionBodySchema = {
  type: "object",
  required: ["deviceId", "deviceSecret"],
  additionalProperties: false,
  properties: {
    deviceId: { type: "string", minLength: 1, maxLength: 255 },
    deviceSecret: { type: "string", minLength: 16, maxLength: 255 },
  },
};

const deviceIdParamSchema = {
  type: "object",
  required: ["deviceId"],
  additionalProperties: false,
  properties: {
    deviceId: { type: "string", minLength: 1, maxLength: 255 },
  },
};

const deviceHistoryQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    start: { type: "string", format: "date-time" },
    end: { type: "string", format: "date-time" },
    limit: { type: "integer", minimum: 1, maximum: MAX_HISTORY_LIMIT },
  },
};

const deviceSchema = {
  type: "object",
  properties: {
    deviceId: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
  },
};

const networkDeviceSchema = {
  type: "object",
  properties: {
    deviceId: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
    owner: {
      type: "object",
      properties: {
        id: { type: "string", format: "uuid" },
        email: { type: "string", format: "email" },
        name: { type: "string" },
        firebaseUid: { type: "string" },
      },
    },
  },
};

const claimedDeviceSchema = {
  type: "object",
  properties: {
    deviceId: { type: "string" },
    deviceSecret: { type: "string" },
  },
};

const provisionedDeviceSchema = {
  type: "object",
  properties: {
    firebaseCustomToken: { type: "string" },
    firebaseUid: { type: "string" },
    deviceId: { type: "string" },
    ownerFirebaseUid: { type: "string" },
    firebaseRootPath: { type: "string" },
    firebaseDevicePath: { type: "string" },
  },
};

const revokedDeviceSchema = {
  type: "object",
  properties: {
    deviceId: { type: "string" },
    status: { type: "string" },
    revokedAt: { type: "string", format: "date-time" },
  },
};

const deviceHistorySampleSchema = {
  type: "object",
  properties: {
    deviceId: { type: "string" },
    ownerUid: { type: "string" },
    ownerFirebaseUid: { type: ["string", "null"] },
    capturedAt: { type: "string", format: "date-time" },
    sourceUpdatedAt: { type: "string", format: "date-time" },
    sampleIntervalStart: { type: "string", format: "date-time" },
    no2: { type: ["number", "null"] },
    soundLevel: { type: ["number", "null"] },
    particulateMatterLevel: { type: ["number", "null"] },
    temperature: { type: ["number", "null"] },
    humidity: { type: ["number", "null"] },
    rawPayload: {
      anyOf: [
        {
          type: "object",
          additionalProperties: true,
        },
        {
          type: "array",
          items: {},
        },
        {
          type: "null",
        },
      ],
    },
  },
};

const errorSchema = {
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};

function ensureDb(app) {
  if (!app.hasDecorator("supabase")) {
    throw app.httpErrors.internalServerError(
      "Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file."
    );
  }
}

function ensureFirebase(app) {
  if (!app.hasDecorator("firebaseAuth")) {
    throw app.httpErrors.internalServerError(
      "Firebase is not configured. Set Firebase env vars and install firebase-admin."
    );
  }
}

function getFirebaseAuthIfConfigured(app) {
  if (!app.hasDecorator("firebaseAuth")) {
    return null;
  }

  return app.firebaseAuth;
}

function generateDeviceId() {
  return `dev_${crypto.randomBytes(16).toString("hex")}`;
}

function generateDeviceSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function createSecretHash(secret) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(secret, salt, 64);
  return `scrypt$${salt.toString("base64")}$${derived.toString("base64")}`;
}

function verifySecret(secret, encodedHash) {
  const [algorithm, saltB64, hashB64] = String(encodedHash || "").split("$");

  if (algorithm !== "scrypt" || !saltB64 || !hashB64) {
    return false;
  }

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(secret, salt, expected.length);

  return crypto.timingSafeEqual(actual, expected);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

async function findOwner(app, ownerUid) {
  const { data: ownerByFirebaseUid, error: ownerLookupError } = await app.supabase
    .from("users")
    .select("id, firebase_uid")
    .eq("firebase_uid", ownerUid)
    .maybeSingle();

  if (ownerLookupError) {
    throw app.httpErrors.internalServerError(ownerLookupError.message);
  }

  if (ownerByFirebaseUid) {
    return ownerByFirebaseUid;
  }

  if (!isUuid(ownerUid)) {
    return null;
  }

  const { data: ownerById, error: ownerIdLookupError } = await app.supabase
    .from("users")
    .select("id, firebase_uid")
    .eq("id", ownerUid)
    .maybeSingle();

  if (ownerIdLookupError) {
    throw app.httpErrors.internalServerError(ownerIdLookupError.message);
  }

  return ownerById;
}

async function findOwnerByDeviceOwnerKey(app, ownerKey) {
  if (!ownerKey) {
    return null;
  }

  return findOwner(app, ownerKey);
}

async function loadOwnersByKeys(app, ownerKeys) {
  if (ownerKeys.length === 0) {
    return new Map();
  }

  const ownerKeySet = [...new Set(ownerKeys.filter(Boolean))];
  const ownersByKey = new Map();

  const { data: ownersById, error: ownersByIdError } = await app.supabase
    .from("users")
    .select("id, email, name, firebase_uid")
    .in("id", ownerKeySet.filter(isUuid));

  if (ownersByIdError && ownersByIdError.code !== "22P02") {
    throw app.httpErrors.internalServerError(ownersByIdError.message);
  }

  for (const owner of ownersById || []) {
    ownersByKey.set(owner.id, owner);

    if (owner.firebase_uid) {
      ownersByKey.set(owner.firebase_uid, owner);
    }
  }

  const nonUuidOwnerKeys = ownerKeySet.filter((ownerKey) => !isUuid(ownerKey));

  if (nonUuidOwnerKeys.length > 0) {
    const { data: ownersByFirebaseUid, error: ownersByFirebaseUidError } = await app.supabase
      .from("users")
      .select("id, email, name, firebase_uid")
      .in("firebase_uid", nonUuidOwnerKeys);

    if (ownersByFirebaseUidError) {
      throw app.httpErrors.internalServerError(ownersByFirebaseUidError.message);
    }

    for (const owner of ownersByFirebaseUid || []) {
      ownersByKey.set(owner.id, owner);

      if (owner.firebase_uid) {
        ownersByKey.set(owner.firebase_uid, owner);
      }
    }
  }

  return ownersByKey;
}

async function ensureOwnedDevice(app, ownerUid, deviceId) {
  const owner = await findOwner(app, ownerUid);

  if (!owner) {
    throw app.httpErrors.notFound("Owner user does not exist");
  }

  const ownerKeys = [...new Set([owner.id, owner.firebase_uid].filter(Boolean))];
  const { data: device, error } = await app.supabase
    .from("devices")
    .select("device_id, owner_uid, name, description, status")
    .eq("device_id", deviceId)
    .in("owner_uid", ownerKeys)
    .maybeSingle();

  if (error) {
    throw app.httpErrors.internalServerError(error.message);
  }

  if (!device) {
    throw app.httpErrors.notFound("Device not found");
  }

  return {
    device,
    owner,
  };
}

async function devicesRoutes(app) {
  app.get(
    "/",
    {
      schema: {
        tags: ["Devices"],
        summary: "Devices index",
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      return { message: "devices api endpoint" };
    }
  );

  app.get(
    "/owned",
    {
      schema: {
        tags: ["Devices"],
        summary: "List devices owned by a user",
        querystring: ownerQuerySchema,
        response: {
          200: {
            type: "object",
            properties: {
              devices: {
                type: "array",
                items: deviceSchema,
              },
            },
          },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);
      const decodedToken = await verifyFirebaseUser(app, request);

      const owner = await findOwner(app, decodedToken.uid);

      if (!owner) {
        throw app.httpErrors.notFound("Owner user does not exist");
      }

      const ownerKeys = [...new Set([owner.id, owner.firebase_uid].filter(Boolean))];
      const devicesById = new Map();

      for (const ownerKey of ownerKeys) {
        const { data, error } = await app.supabase
          .from("devices")
          .select("device_id, name, description, status")
          .eq("owner_uid", ownerKey);

        if (error) {
          if (error.code === "22P02") {
            continue;
          }

          throw app.httpErrors.internalServerError(error.message);
        }

        for (const device of data || []) {
          devicesById.set(device.device_id, {
            deviceId: device.device_id,
            name: device.name || "Unnamed Node",
            description: device.description || "",
            status: device.status,
          });
        }
      }

      return {
        devices: Array.from(devicesById.values()),
      };
    }
  );

  app.get(
    "/:deviceId/history",
    {
      schema: {
        tags: ["Devices"],
        summary: "Fetch historical telemetry for a device",
        params: deviceIdParamSchema,
        querystring: deviceHistoryQuerySchema,
        response: {
          200: {
            type: "object",
            properties: {
              deviceId: { type: "string" },
              samples: {
                type: "array",
                items: deviceHistorySampleSchema,
              },
            },
          },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);
      const decodedToken = await verifyFirebaseUser(app, request);

      const { deviceId } = request.params;
      const { start, end, limit } = request.query;
      const { owner } = await ensureOwnedDevice(app, decodedToken.uid, deviceId);
      const canonicalOwnerUid = owner.firebase_uid || owner.id;

      let query = app.supabase
        .from("device_history")
        .select(
          "device_id, owner_uid, owner_firebase_uid, captured_at, source_updated_at, sample_interval_start, no2, sound_level, particulate_matter_level, temperature, humidity, raw_payload"
        )
        .eq("device_id", deviceId)
        .eq("owner_uid", canonicalOwnerUid);

      if (start) {
        query = query.gte("sample_interval_start", start);
      }

      if (end) {
        query = query.lte("sample_interval_start", end);
      }

      const { data, error } = await query
        .order("sample_interval_start", { ascending: false })
        .limit(clampHistoryLimit(limit));

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      return {
        deviceId,
        samples: (data || []).map((sample) => ({
          deviceId: sample.device_id,
          ownerUid: sample.owner_uid,
          ownerFirebaseUid: sample.owner_firebase_uid,
          capturedAt: sample.captured_at,
          sourceUpdatedAt: sample.source_updated_at,
          sampleIntervalStart: sample.sample_interval_start,
          no2: sample.no2,
          soundLevel: sample.sound_level,
          particulateMatterLevel: sample.particulate_matter_level,
          temperature: sample.temperature,
          humidity: sample.humidity,
          rawPayload: sample.raw_payload,
        })),
      };
    }
  );

  app.get(
    "/network",
    {
      schema: {
        tags: ["Devices"],
        summary: "List all devices across the network with owner details",
        response: {
          200: {
            type: "object",
            properties: {
              devices: {
                type: "array",
                items: networkDeviceSchema,
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async () => {
      ensureDb(app);

      const { data: devices, error: devicesError } = await app.supabase
        .from("devices")
        .select("device_id, owner_uid, name, description, status")
        .order("device_id", { ascending: true });

      if (devicesError) {
        throw app.httpErrors.internalServerError(devicesError.message);
      }

      const ownersByKey = await loadOwnersByKeys(
        app,
        (devices || []).map((device) => device.owner_uid)
      );

      const devicesById = new Map();

      for (const device of devices || []) {
        const owner = ownersByKey.get(device.owner_uid);

        if (!owner || devicesById.has(device.device_id)) {
          continue;
        }

        devicesById.set(device.device_id, {
          deviceId: device.device_id,
          name: device.name || "Unnamed Node",
          description: device.description || "",
          status: device.status,
          owner: {
            id: owner.id,
            email: owner.email,
            name: owner.name,
            firebaseUid: owner.firebase_uid,
          },
        });
      }

      return {
        devices: Array.from(devicesById.values()),
      };
    }
  );

  async function claimDevice(ownerUid, name, description, reply) {
    ensureDb(app);
    const owner = await findOwner(app, ownerUid);

    if (!owner) {
      throw app.httpErrors.notFound("Owner user does not exist");
    }

    const deviceId = generateDeviceId();
    const deviceSecret = generateDeviceSecret();
    const deviceCodeHash = createSecretHash(deviceSecret);

    const ownerKeys = [...new Set([owner.id, owner.firebase_uid].filter(Boolean))];
    let insertError = null;

    for (const ownerKey of ownerKeys) {
      const { error } = await app.supabase.from("devices").insert({
        device_id: deviceId,
        owner_uid: ownerKey,
        name,
        description,
        device_code_hash: deviceCodeHash,
        status: "active",
      });

      if (!error) {
        insertError = null;
        break;
      }

      insertError = error;

      if (error.code === "22P02") {
        continue;
      }

      if (error.code !== "23503") {
        break;
      }
    }

    if (insertError) {
      throw app.httpErrors.internalServerError(insertError.message);
    }

    reply.code(201);
    return {
      deviceId,
      deviceSecret,
    };
  }

  app.get(
    "/claim",
    {
      schema: {
        tags: ["Devices"],
        summary: "Claim a device with generated credentials",
        querystring: claimQuerySchema,
        response: {
          201: claimedDeviceSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const decodedToken = await verifyFirebaseUser(app, request);

      return claimDevice(decodedToken.uid, "", "", reply);
    }
  );

  app.post(
    "/claim",
    {
      schema: {
        tags: ["Devices"],
        summary: "Claim a named device with generated credentials",
        body: claimBodySchema,
        response: {
          201: claimedDeviceSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const decodedToken = await verifyFirebaseUser(app, request);

      return claimDevice(
        decodedToken.uid,
        request.body.name.trim(),
        request.body.description.trim(),
        reply
      );
    }
  );

  app.post(
    "/provision",
    {
      schema: {
        tags: ["Devices"],
        summary: "Provision a device and mint a Firebase custom token",
        body: provisionBodySchema,
        response: {
          200: provisionedDeviceSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);
      ensureFirebase(app);

      const { deviceId, deviceSecret } = request.body;

      const { data: device, error } = await app.supabase
        .from("devices")
        .select("device_id, device_code_hash, status, owner_uid")
        .eq("device_id", deviceId)
        .maybeSingle();

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      if (!device) {
        throw app.httpErrors.notFound("Device not found");
      }

      if (device.status !== "active") {
        throw app.httpErrors.forbidden("Device is not active");
      }

      if (!verifySecret(deviceSecret, device.device_code_hash)) {
        throw app.httpErrors.unauthorized("Invalid device credentials");
      }

      const owner = await findOwnerByDeviceOwnerKey(app, device.owner_uid);

      if (!owner?.firebase_uid) {
        throw app.httpErrors.forbidden("Device owner is not configured for Firebase access");
      }

      const firebaseRootPath = `/users/${owner.firebase_uid}`;
      const firebaseDevicePath = `${firebaseRootPath}/devices/${device.device_id}`;
      const firebaseUid = `device:${device.device_id}`;
      const claims = {
        role: "device",
        device_id: device.device_id,
        owner_uid: owner.firebase_uid,
        rtdb_prefix: firebaseRootPath,
        device_rtdb_prefix: firebaseDevicePath,
      };

      const firebaseCustomToken = await app.firebaseAuth.createCustomToken(
        firebaseUid,
        claims
      );

      return {
        firebaseCustomToken,
        firebaseUid,
        deviceId: device.device_id,
        ownerFirebaseUid: owner.firebase_uid,
        firebaseRootPath,
        firebaseDevicePath,
      };
    }
  );

  app.post(
    "/:deviceId/revoke",
    {
      schema: {
        tags: ["Devices"],
        summary: "Revoke a device",
        params: deviceIdParamSchema,
        response: {
          200: revokedDeviceSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);
      const decodedToken = await verifyFirebaseUser(app, request);

      const { deviceId } = request.params;
      await ensureOwnedDevice(app, decodedToken.uid, deviceId);
      const revokedAt = new Date().toISOString();

      const { data: device, error } = await app.supabase
        .from("devices")
        .update({
          status: "revoked",
          revoked_at: revokedAt,
        })
        .eq("device_id", deviceId)
        .select("device_id, status, revoked_at")
        .maybeSingle();

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      if (!device) {
        throw app.httpErrors.notFound("Device not found");
      }

      const firebaseAuth = getFirebaseAuthIfConfigured(app);

      if (firebaseAuth) {
        const firebaseUid = `device:${deviceId}`;

        try {
          await firebaseAuth.revokeRefreshTokens(firebaseUid);
        } catch (firebaseError) {
          app.log.warn({ firebaseError, firebaseUid }, "Failed to revoke Firebase tokens");
        }
      }

      return {
        deviceId: device.device_id,
        status: device.status,
        revokedAt: device.revoked_at,
      };
    }
  );

  app.delete(
    "/:deviceId",
    {
      schema: {
        tags: ["Devices"],
        summary: "Delete a device",
        params: deviceIdParamSchema,
        querystring: deleteDeviceQuerySchema,
        response: {
          204: { description: "Device deleted successfully." },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      ensureDb(app);
      const decodedToken = await verifyFirebaseUser(app, request);

      const { deviceId } = request.params;
      const owner = await findOwner(app, decodedToken.uid);

      if (!owner) {
        throw app.httpErrors.notFound("Owner user does not exist");
      }

      const ownerKeys = [...new Set([owner.id, owner.firebase_uid].filter(Boolean))];

      const { data: deletedDevice, error } = await app.supabase
        .from("devices")
        .delete()
        .eq("device_id", deviceId)
        .in("owner_uid", ownerKeys)
        .select("device_id")
        .maybeSingle();

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      if (!deletedDevice) {
        throw app.httpErrors.notFound("Device not found");
      }

      const firebaseAuth = getFirebaseAuthIfConfigured(app);

      if (firebaseAuth) {
        const firebaseUid = `device:${deviceId}`;

        try {
          await firebaseAuth.deleteUser(firebaseUid);
        } catch (firebaseError) {
          // User may not exist in Auth yet if it never signed in.
          if (firebaseError && firebaseError.code !== "components/user-not-found") {
            app.log.warn({ firebaseError, firebaseUid }, "Failed to delete Firebase user");
          }
        }
      }

      reply.code(204);
      return null;
    }
  );
}

module.exports = devicesRoutes;
module.exports.helpers = {
  createSecretHash,
  generateDeviceId,
  generateDeviceSecret,
  isUuid,
  verifySecret,
};
