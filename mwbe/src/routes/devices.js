/**
 * Fastify device provisioning endpoints.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

const crypto = require("node:crypto");

const claimQuerySchema = {
  type: "object",
  required: ["ownerUid"],
  additionalProperties: false,
  properties: {
    ownerUid: { type: "string", minLength: 1, maxLength: 255 },
  },
};

const ownerQuerySchema = {
  type: "object",
  required: ["ownerUid"],
  additionalProperties: false,
  properties: {
    ownerUid: { type: "string", minLength: 1, maxLength: 255 },
  },
};

const claimBodySchema = {
  type: "object",
  required: ["ownerUid", "name", "description"],
  additionalProperties: false,
  properties: {
    ownerUid: { type: "string", minLength: 1, maxLength: 255 },
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

const deviceSchema = {
  type: "object",
  properties: {
    deviceId: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    status: { type: "string" },
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

      const owner = await findOwner(app, request.query.ownerUid);

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
    async (request, reply) => claimDevice(request.query.ownerUid, "", "", reply)
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
    async (request, reply) =>
      claimDevice(
        request.body.ownerUid,
        request.body.name.trim(),
        request.body.description.trim(),
        reply
      )
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
        .select("device_id, device_code_hash, status")
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

      const firebaseUid = `device:${device.device_id}`;
      const claims = {
        role: "device",
        device_id: device.device_id,
        rtdb_prefix: `/devices/${device.device_id}`,
      };

      const firebaseCustomToken = await app.firebaseAuth.createCustomToken(
        firebaseUid,
        claims
      );

      return {
        firebaseCustomToken,
        firebaseUid,
        deviceId: device.device_id,
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

      const { deviceId } = request.params;
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
        response: {
          204: { description: "Device deleted successfully." },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      ensureDb(app);

      const { deviceId } = request.params;

      const { data: deletedDevice, error } = await app.supabase
        .from("devices")
        .delete()
        .eq("device_id", deviceId)
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
