const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const sensible = require("@fastify/sensible");
const registerSupabase = require("./supabase");
const registerFirebase = require("./firebase");

function buildCorsOrigin() {
  const configuredOrigin = process.env.CORS_ORIGIN;

  if (!configuredOrigin || configuredOrigin === "*") {
    return true;
  }

  if (configuredOrigin === "true") {
    return true;
  }

  const allowedOrigins = configuredOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (allowedOrigins.length === 0) {
    return true;
  }

  return (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"), false);
  };
}

function registerPlugins(app) {
  app.register(sensible);
  app.register(helmet);
  app.register(cors, {
    origin: buildCorsOrigin(),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  registerSupabase(app);
  registerFirebase(app);
}

module.exports = registerPlugins;
