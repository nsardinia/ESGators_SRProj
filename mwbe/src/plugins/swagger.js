/**
 * Swagger/OpenAPI documentation for the Fastify API.
 */
const swagger = require("@fastify/swagger");
const swaggerUi = require("@fastify/swagger-ui");

function registerSwagger(app) {
  app.register(swagger, {
    openapi: {
      info: {
        title: "ESGators Backend API",
        description: "API for user management and IoT device provisioning.",
        version: "1.0.0",
      },
      servers: [
        {
          url: process.env.PUBLIC_API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
          description: "Current API server",
        },
      ],
      tags: [
        { name: "System", description: "Service status and basic discovery endpoints" },
        { name: "Users", description: "User account CRUD operations" },
        { name: "Devices", description: "IoT device ownership and provisioning flows" },
      ],
    },
  });

  app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: false,
    },
    staticCSP: true,
    transformSpecificationClone: true,
  });
}

module.exports = registerSwagger;
