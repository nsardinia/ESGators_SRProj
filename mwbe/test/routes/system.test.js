jest.mock("../../src/lib/firebaseUserAuth", () => ({
  verifyFirebaseUser: jest.fn(),
}));

const { verifyFirebaseUser } = require("../../src/lib/firebaseUserAuth");
const { buildApiApp } = require("../support/apiHarness");

describe("system and integration routes", () => {
  beforeEach(() => {
    verifyFirebaseUser.mockReset();
  });

  // Confirms the root health endpoint stays usable as a simple uptime probe.
  test("GET /health returns service metadata", async () => {
    const { app } = await buildApiApp();

    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: "ok",
        service: "fastify-starter",
      })
    );

    await app.close();
  });

  // Verifies the API index advertises the expected entry points.
  test("GET / returns API discovery links", async () => {
    const { app } = await buildApiApp();

    const response = await app.inject({
      method: "GET",
      url: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: "Fastify starter API is running.",
      docs: "/docs",
      openApiJson: "/documentation/json",
    });

    await app.close();
  });

  // Checks that history rows are reshaped into the compatibility feed consumed downstream.
  test("GET /api/sensors/latest returns normalized feed items", async () => {
    const { app } = await buildApiApp({
      deviceHistory: [
        {
          device_id: "dev_1",
          sample_interval_start: "2026-04-20T12:00:00.000Z",
          source_updated_at: "2026-04-20T12:00:05.000Z",
          no2: 11,
          sound_level: 58,
          temperature: 22.5,
          humidity: 48,
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/sensors/latest?deviceId=dev_1&limit=5",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      data: {
        items: [
          {
            sensor_id: "dev_1",
            metric_type: "no2",
            value: 11,
            timestamp: "2026-04-20T12:00:05.000Z",
          },
          {
            sensor_id: "dev_1",
            metric_type: "noise_levels",
            value: 58,
            timestamp: "2026-04-20T12:00:05.000Z",
          },
          {
            sensor_id: "dev_1",
            metric_type: "temperature",
            value: 22.5,
            timestamp: "2026-04-20T12:00:05.000Z",
          },
          {
            sensor_id: "dev_1",
            metric_type: "humidity",
            value: 48,
            timestamp: "2026-04-20T12:00:05.000Z",
          },
        ],
      },
    });

    await app.close();
  });

  // Ensures authenticated configuration writes land in the owner-scoped Firebase path.
  test("POST /configuration/radio-network saves owner config to Firebase", async () => {
    verifyFirebaseUser.mockResolvedValue({ uid: "firebase-owner-1" });
    const { app, firebaseWrites } = await buildApiApp({
      users: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          email: "owner@example.com",
          name: "Owner",
          firebase_uid: "firebase-owner-1",
          created_at: "2026-04-20T12:00:00.000Z",
          updated_at: "2026-04-20T12:00:00.000Z",
        },
      ],
    });

    const config = {
      version: 1,
      gateways: [1],
      nodes: [
        {
          nodeId: 2,
          role: "client",
          preferredGateway: 1,
          fallbackGateway: 0,
          enabled: true,
        },
      ],
    };

    const response = await app.inject({
      method: "POST",
      url: "/configuration/radio-network",
      payload: config,
    });

    const persistedConfig = {
      version: 1,
      gateways: ["1"],
      nodes: [
        {
          nodeId: "2",
          role: "client",
          preferredGateway: "1",
          fallbackGateway: "0",
          enabled: true,
        },
      ],
    };

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: "Radio network configuration saved to Firebase Realtime Database",
      path: "users/firebase-owner-1/config/radio-network",
      config: persistedConfig,
    });
    expect(
      firebaseWrites.get("users/firebase-owner-1/config/radio-network")
    ).toEqual(persistedConfig);

    await app.close();
  });
});
