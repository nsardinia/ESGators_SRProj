/**
 * Radio network configuration endpoints.
 *
 * Last Edit: Nicholas Sardinia, 3/29/2026
 */

const { verifyFirebaseUser } = require("../lib/firebaseUserAuth");

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "")
  );
}

const ownerQuerySchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};

const nodeIdentifierSchema = {
  anyOf: [
    { type: "string", minLength: 1, maxLength: 255 },
    { type: "integer" },
  ],
};

const radioNetworkNodeSchema = {
  type: "object",
  required: ["nodeId", "role", "preferredGateway", "fallbackGateway", "enabled"],
  additionalProperties: false,
  properties: {
    nodeId: nodeIdentifierSchema,
    role: { type: "string", enum: ["client", "gateway"] },
    preferredGateway: nodeIdentifierSchema,
    fallbackGateway: {
      anyOf: [nodeIdentifierSchema, { type: "integer", enum: [0] }],
    },
    enabled: { type: "boolean" },
  },
};

const radioNetworkConfigSchema = {
  type: "object",
  required: ["version", "gateways", "nodes"],
  additionalProperties: false,
  properties: {
    version: { type: "integer", enum: [1] },
    gateways: {
      type: "array",
      items: nodeIdentifierSchema,
    },
    nodes: {
      type: "array",
      items: radioNetworkNodeSchema,
    },
  },
};

const persistedConfigSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    path: { type: "string" },
    config: radioNetworkConfigSchema,
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

function ensureFirebaseDb(app) {
  if (!app.hasDecorator("firebaseDb")) {
    throw app.httpErrors.internalServerError(
      "Firebase Realtime Database is not configured. Set FIREBASE_DATABASE_URL and Firebase credentials."
    );
  }
}

function ensureDb(app) {
  if (!app.hasDecorator("supabase")) {
    throw app.httpErrors.internalServerError(
      "Database is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file."
    );
  }
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

async function configurationRoutes(app) {
  app.post(
    "/radio-network",
    {
      schema: {
        tags: ["Configuration"],
        summary: "Persist radio network configuration to Firebase Realtime Database",
        querystring: ownerQuerySchema,
        body: radioNetworkConfigSchema,
        response: {
          200: persistedConfigSchema,
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);
      ensureFirebaseDb(app);
      const decodedToken = await verifyFirebaseUser(app, request);

      const owner = await findOwner(app, decodedToken.uid);

      if (!owner?.firebase_uid) {
        throw app.httpErrors.notFound("Owner user does not exist");
      }

      const configPath = `users/${owner.firebase_uid}/config/radio-network`;
      await app.firebaseDb.ref(configPath).set(request.body);

      return {
        message: "Radio network configuration saved to Firebase Realtime Database",
        path: configPath,
        config: request.body,
      };
    }
  );
}

module.exports = configurationRoutes;
