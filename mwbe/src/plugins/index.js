/**
 * Fastify index plugin registration endpoint to integrate dependencies for routes. 
 * Handles connecting to Supabase, Firebase, and providing basic observability to CORS issues.
 * 
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */

// Configuring plugins and setting security parameters
const cors = require("@fastify/cors");
const helmet = require("@fastify/helmet");
const sensible = require("@fastify/sensible");
const registerSwagger = require("./swagger");
const registerSupabase = require("./supabase");
const registerFirebase = require("./firebase");
const registerDeviceHistory = require("../services/deviceHistory");

//Set default web origins for testing. Pattern to allow vercel deps. 
//To avoid CORS errors, it is important to keep this updated.
const DEFAULT_ALLOWED_WEB_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://es-gators.vercel.app",
];
const DEFAULT_ALLOWED_WEB_ORIGIN_PATTERNS = [
  /^https:\/\/es-gators(?:-[a-z0-9-]+)?\.vercel\.app$/i,
  /^https:\/\/[a-z0-9-]+\.vercel\.app$/i,
];

function normalizeOrigin(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

//Build the fastify CORS origin configuration
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
    const normalizedOrigin = normalizeOrigin(origin);

    if (
      !origin ||
      allowedOrigins.includes(normalizedOrigin) ||
      DEFAULT_ALLOWED_WEB_ORIGIN_PATTERNS.some((pattern) => pattern.test(normalizedOrigin))
    ) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"), false);
  };
}

//Register fastify plugins (essentially functions that take the app instance and attach a service)
function registerPlugins(app) {
  app.register(sensible);
  registerSwagger(app);
  app.register(helmet);
  app.register(cors, {
    origin: buildCorsOrigin(),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
  registerSupabase(app);
  registerFirebase(app);
  registerDeviceHistory(app);
}

module.exports = registerPlugins;
module.exports.buildCorsOrigin = buildCorsOrigin;
