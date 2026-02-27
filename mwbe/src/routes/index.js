const devicesRoutes = require("./devices");
const rootRoutes = require("./root");
const usersRoutes = require("./users");

function registerRoutes(app) {
  app.register(rootRoutes, { prefix: "/" });
  app.register(usersRoutes, { prefix: "/users" });
  app.register(devicesRoutes, {prefix: "/devices"});
}

module.exports = registerRoutes;
