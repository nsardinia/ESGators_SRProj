/**
 * Fastify basic functionality test endpoints
 * 
 * TODO: remove. 
 * 
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
async function rootRoutes(app) {
  app.get("/health", async () => {
    return {
      status: "ok",
      service: "fastify-starter",
      timestamp: new Date().toISOString(),
    };
  });

  app.get("/", async () => {
    return {
      message: "Fastify starter API is running.",
      docs: "See README.md for setup and structure.",
    };
  });
}

module.exports = rootRoutes;
