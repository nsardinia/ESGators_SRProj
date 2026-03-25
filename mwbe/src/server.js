/**
 * Server setup for backend application
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
require("dotenv").config();

const buildApp = require("./app");

const app = buildApp();
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

// Clean startup
async function start() {
  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error(error, "Failed to start server");
    process.exit(1);
  }
}

// Clean shutdown
async function shutdown(signal) {
  try {
    app.log.info({ signal }, "Shutting down server");
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Error during shutdown");
    process.exit(1);
  }
}

// Stops the server on posix termination signals.
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
