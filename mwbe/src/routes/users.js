/**
 * Fastify user management endpoints.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

const userBodySchema = {
  type: "object",
  required: ["email", "name", "firebaseUid"],
  additionalProperties: false,
  properties: {
    email: { type: "string", format: "email", minLength: 3, maxLength: 255 },
    name: { type: "string", minLength: 1, maxLength: 120 },
    firebaseUid: { type: "string", minLength: 1, maxLength: 255 },
  },
};

const userIdParamSchema = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", format: "uuid" },
  },
};

const userSchema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    email: { type: "string", format: "email" },
    name: { type: "string" },
    firebase_uid: { type: "string" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
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

async function usersRoutes(app) {
  app.get(
    "/",
    {
      schema: {
        tags: ["Users"],
        summary: "List users",
        response: {
          200: {
            type: "object",
            properties: {
              users: {
                type: "array",
                items: userSchema,
              },
            },
          },
          500: errorSchema,
        },
      },
    },
    async () => {
      ensureDb(app);

      const { data, error } = await app.supabase
        .from("users")
        .select("id, email, name, firebase_uid, created_at, updated_at")
        .order("created_at", { ascending: false });

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      return { users: data };
    }
  );

  app.get(
    "/:id",
    {
      schema: {
        tags: ["Users"],
        summary: "Get user by ID",
        params: userIdParamSchema,
        response: {
          200: {
            type: "object",
            properties: {
              user: userSchema,
            },
          },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);

      const { data, error } = await app.supabase
        .from("users")
        .select("id, email, name, firebase_uid, created_at, updated_at")
        .eq("id", request.params.id)
        .maybeSingle();

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      if (!data) {
        throw app.httpErrors.notFound("User not found");
      }

      return { user: data };
    }
  );

  app.post(
    "/",
    {
      schema: {
        tags: ["Users"],
        summary: "Create or upsert a user",
        body: userBodySchema,
        response: {
          200: {
            type: "object",
            properties: {
              user: userSchema,
            },
          },
          201: {
            type: "object",
            properties: {
              user: userSchema,
            },
          },
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      ensureDb(app);

      const { email, name, firebaseUid } = request.body;

      const { data: existingUser, error: lookupError } = await app.supabase
        .from("users")
        .select("id, email, name, firebase_uid, created_at, updated_at")
        .or(`email.eq.${email},firebase_uid.eq.${firebaseUid}`)
        .maybeSingle();

      if (lookupError) {
        throw app.httpErrors.internalServerError(lookupError.message);
      }

      if (existingUser) {
        if (
          existingUser.name !== name ||
          existingUser.email !== email ||
          existingUser.firebase_uid !== firebaseUid
        ) {
          const { data: updatedUser, error: updateError } = await app.supabase
            .from("users")
            .update({
              email,
              name,
              firebase_uid: firebaseUid,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingUser.id)
            .select("id, email, name, firebase_uid, created_at, updated_at")
            .maybeSingle();

          if (updateError) {
            throw app.httpErrors.internalServerError(updateError.message);
          }

          return { user: updatedUser };
        }

        return { user: existingUser };
      }

      const { data, error } = await app.supabase
        .from("users")
        .insert({ email, name, firebase_uid: firebaseUid })
        .select("id, email, name, firebase_uid, created_at, updated_at")
        .single();

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      reply.code(201);
      return { user: data };
    }
  );

  app.put(
    "/:id",
    {
      schema: {
        tags: ["Users"],
        summary: "Update a user",
        params: userIdParamSchema,
        body: userBodySchema,
        response: {
          200: {
            type: "object",
            properties: {
              user: userSchema,
            },
          },
          404: errorSchema,
          409: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request) => {
      ensureDb(app);

      const { id } = request.params;
      const { email, name, firebaseUid } = request.body;

      const { data, error } = await app.supabase
        .from("users")
        .update({
          email,
          name,
          firebase_uid: firebaseUid,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id, email, name, firebase_uid, created_at, updated_at")
        .maybeSingle();

      if (error) {
        if (error.code === "23505") {
          throw app.httpErrors.conflict("A user with that email already exists");
        }

        throw app.httpErrors.internalServerError(error.message);
      }

      if (!data) {
        throw app.httpErrors.notFound("User not found");
      }

      return { user: data };
    }
  );

  app.delete(
    "/:id",
    {
      schema: {
        tags: ["Users"],
        summary: "Delete a user",
        params: userIdParamSchema,
        response: {
          204: { description: "User deleted successfully." },
          404: errorSchema,
          500: errorSchema,
        },
      },
    },
    async (request, reply) => {
      ensureDb(app);

      const { data, error } = await app.supabase
        .from("users")
        .delete()
        .eq("id", request.params.id)
        .select("id")
        .maybeSingle();

      if (error) {
        throw app.httpErrors.internalServerError(error.message);
      }

      if (!data) {
        throw app.httpErrors.notFound("User not found");
      }

      reply.code(204);
      return null;
    }
  );
}

module.exports = usersRoutes;
