/**
 * Fastify app file for backend to handle device provisioning and user accounts through Supabase (postgress).
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */

const Fastify = require("fastify");
const registerPlugins = require("./plugins");
const registerRoutes = require("./routes");

function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  registerPlugins(app);
  registerRoutes(app);

  return app;
}

module.exports = buildApp;
