/**
 * Fastify index plugin registration endpoint to integrate dependencies for routes. 
 * Handles connecting to Supabase, Firebase, and providing basic observability to CORS issues.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const sensible = require("@fastify/sensible");
const registerSwagger = require("./swagger");
const registerSupabase = require("./supabase");
const registerFirebase = require("./firebase");
const registerDeviceHistory = require("../services/deviceHistory");
const DEFAULT_ALLOWED_WEB_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildCorsOrigin() {
  const configuredOrigin = process.env.CORS_ORIGIN;
  const configuredOrigins = process.env.CORS_ORIGINS;
  const rawSources = [
    configuredOrigin,
    configuredOrigins,
    process.env.FRONTEND_URL,
    process.env.FRONTEND_ORIGIN,
    process.env.APP_URL,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
  ];
  const allowAllOrigins = rawSources.some((value) =>
    ["*", "true"].includes(String(value || "").trim().toLowerCase())
  );

  if (allowAllOrigins) {
    return true;
  }

  const allowedOrigins = [...new Set(
    [...DEFAULT_ALLOWED_WEB_ORIGINS, ...rawSources.flatMap((source) => String(source || "").split(","))]
      .map((origin) => normalizeOrigin(origin))
      .filter(Boolean)
  )];

  if (allowedOrigins.length === 0) {
    return true;
  }

  return (origin, callback) => {
    if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"), false);
  };
}
const registerGrafanaMetrics = require("./grafanaMetrics");

function registerPlugins(app) {
  app.register(sensible);
  registerSwagger(app);
  app.register(helmet);
  app.register(cors, {
    origin: buildCorsOrigin(),
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  registerSupabase(app);
  registerFirebase(app);
  registerDeviceHistory(app);
  registerGrafanaMetrics(app);
}

module.exports = registerPlugins;
module.exports.buildCorsOrigin = buildCorsOrigin;
