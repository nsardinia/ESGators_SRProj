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

function buildStartupHint(error) {
  switch (error?.code) {
    case "EADDRINUSE":
      return `Port ${port} is already in use on ${host}. Stop the other process or change PORT in mwbe/.env.`;
    case "EACCES":
    case "EPERM":
      return `The process is not allowed to listen on ${host}:${port}. Try another PORT or check local permissions/firewall settings.`;
    default:
      return null;
  }
}

// Clean startup
async function start() {
  try {
    await app.listen({ host, port });
    app.log.info({ host, port }, "MWBE server started");
  } catch (error) {
    const hint = buildStartupHint(error);

    app.log.error(
      {
        err: error,
        host,
        port,
        ...(hint ? { hint } : {}),
      },
      "Failed to start server"
    );
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
