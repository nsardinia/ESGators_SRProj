/**
 * Fastify basic functionality test endpoints
 * 
 * TODO: remove. 
 * 
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
async function rootRoutes(app) {
  app.get(
    "/health",
    {
      schema: {
        tags: ["System"],
        summary: "Health check",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string" },
              service: { type: "string" },
              timestamp: { type: "string", format: "date-time" },
            },
          },
        },
      },
    },
    async () => {
      return {
        status: "ok",
        service: "fastify-starter",
        timestamp: new Date().toISOString(),
      };
    }
  );

  app.get(
    "/",
    {
      schema: {
        tags: ["System"],
        summary: "API index",
        response: {
          200: {
            type: "object",
            properties: {
              message: { type: "string" },
              docs: { type: "string" },
              openApiJson: { type: "string" },
            },
          },
        },
      },
    },
    async () => {
      return {
        message: "Fastify starter API is running.",
        docs: "/docs",
        openApiJson: "/documentation/json",
      };
    }
  );
}

module.exports = rootRoutes;
