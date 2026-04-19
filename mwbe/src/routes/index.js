/**
 * Fastify backend routes index
 * 
 * Last Edit: Nicholas Sardinia, 4/19/2026
 */
const devicesRoutes = require("./devices");
const configurationRoutes = require("./configuration");
const rootRoutes = require("./root");
const sensorsRoutes = require("./sensors");
const usersRoutes = require("./users");

function registerRoutes(app) {
  app.register(rootRoutes, { prefix: "/" });
  app.register(sensorsRoutes, { prefix: "/api/sensors" });
  app.register(usersRoutes, { prefix: "/users" });
  app.register(devicesRoutes, {prefix: "/devices"});
  app.register(configurationRoutes, { prefix: "/configuration" });
}

module.exports = registerRoutes;
