const Fastify = require("fastify");
const rootRoutes = require("../../src/routes/root");

describe("root routes", () => {
  test("GET /health returns service health metadata", async () => {
    const app = Fastify();
    await app.register(rootRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);

    const payload = response.json();
    expect(payload.status).toBe("ok");
    expect(payload.service).toBe("fastify-starter");
    expect(typeof payload.timestamp).toBe("string");

    await app.close();
  });

  test("GET / returns api discovery links", async () => {
    const app = Fastify();
    await app.register(rootRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      docs: "/docs",
      message: "Fastify starter API is running.",
      openApiJson: "/documentation/json",
    });

    await app.close();
  });
});
