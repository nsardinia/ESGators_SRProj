/**
 * Fastify backend routes index
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
const devicesRoutes = require("./devices");
const rootRoutes = require("./root");
const usersRoutes = require("./users");
const iotRoutes = require("./iot");

function registerRoutes(app) {
  app.register(rootRoutes, { prefix: "/" });
  app.register(usersRoutes, { prefix: "/users" });
  app.register(devicesRoutes, {prefix: "/devices"});
  app.register(iotRoutes, { prefix: "/iot" });
}

module.exports = registerRoutes;
