jest.mock("../../src/lib/firebaseUserAuth", () => ({
  verifyFirebaseUser: jest.fn(),
}));

const { verifyFirebaseUser } = require("../../src/lib/firebaseUserAuth");
const devicesRoutes = require("../../src/routes/devices");
const { buildApiApp } = require("../support/apiHarness");

describe("device endpoints", () => {
  // Shared owner fixture used by the authenticated device routes.
  const owner = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    name: "Owner",
    firebase_uid: "firebase-owner-1",
    created_at: "2026-04-20T12:00:00.000Z",
    updated_at: "2026-04-20T12:00:00.000Z",
  };

  beforeEach(() => {
    verifyFirebaseUser.mockReset();
    verifyFirebaseUser.mockResolvedValue({ uid: owner.firebase_uid });
  });

  // Sanity-checks the device route namespace is mounted as expected.
  test("GET /devices returns the devices index response", async () => {
    const { app } = await buildApiApp();

    const response = await app.inject({
      method: "GET",
      url: "/devices",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: "devices api endpoint",
    });

    await app.close();
  });

  // Verifies the owner-scoped list response shape clients depend on.
  test("GET /devices/owned returns devices for the authenticated owner", async () => {
    const { app } = await buildApiApp({
      users: [owner],
      devices: [
        {
          device_id: "dev_owned",
          owner_uid: owner.firebase_uid,
          name: "Owned Device",
          description: "Neighborhood sensor",
          status: "active",
          latitude: 29.65,
          longitude: -82.32,
          location_label: "Campus",
          is_location_unknown: false,
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: "/devices/owned",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      devices: [
        {
          deviceId: "dev_owned",
          name: "Owned Device",
          description: "Neighborhood sensor",
          status: "active",
          latitude: 29.65,
          longitude: -82.32,
          locationLabel: "Campus",
          isLocationUnknown: false,
        },
      ],
    });

    await app.close();
  });

  // Confirms historical telemetry is mapped back into API field names.
  test("GET /devices/:deviceId/history returns endpoint-ready samples", async () => {
    const { app } = await buildApiApp({
      users: [owner],
      devices: [
        {
          device_id: "dev_history",
          owner_uid: owner.firebase_uid,
          name: "History Device",
          description: "",
          status: "active",
          latitude: 29.65,
          longitude: -82.32,
          location_label: "Campus",
          is_location_unknown: false,
        },
      ],
      deviceHistory: [
        {
          device_id: "dev_history",
          owner_uid: owner.firebase_uid,
          owner_firebase_uid: owner.firebase_uid,
          captured_at: "2026-04-20T12:00:10.000Z",
          source_updated_at: "2026-04-20T12:00:09.000Z",
          sample_interval_start: "2026-04-20T12:00:00.000Z",
          no2: 8,
          sound_level: 60,
          particulate_matter_level: 12,
          temperature: 23,
          humidity: 50,
          raw_payload: { telemetry: true },
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: "/devices/dev_history/history?limit=10",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deviceId: "dev_history",
      samples: [
        {
          deviceId: "dev_history",
          ownerUid: owner.firebase_uid,
          ownerFirebaseUid: owner.firebase_uid,
          capturedAt: "2026-04-20T12:00:10.000Z",
          sourceUpdatedAt: "2026-04-20T12:00:09.000Z",
          sampleIntervalStart: "2026-04-20T12:00:00.000Z",
          no2: 8,
          soundLevel: 60,
          particulateMatterLevel: 12,
          temperature: 23,
          humidity: 50,
          rawPayload: { telemetry: true },
        },
      ],
    });

    await app.close();
  });

  // Ensures the network listing joins owner metadata into each visible device.
  test("GET /devices/network returns devices with owner details", async () => {
    const { app } = await buildApiApp({
      users: [owner],
      devices: [
        {
          device_id: "dev_network",
          owner_uid: owner.firebase_uid,
          name: "Network Device",
          description: "Shared node",
          status: "active",
          latitude: 29.65,
          longitude: -82.32,
          location_label: "Downtown",
          is_location_unknown: false,
        },
      ],
    });

    const response = await app.inject({
      method: "GET",
      url: "/devices/network",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      devices: [
        {
          deviceId: "dev_network",
          name: "Network Device",
          description: "Shared node",
          status: "active",
          owner: {
            id: owner.id,
            email: owner.email,
            name: owner.name,
            firebaseUid: owner.firebase_uid,
          },
          latitude: 29.65,
          longitude: -82.32,
          locationLabel: "Downtown",
          isLocationUnknown: false,
        },
      ],
    });

    await app.close();
  });

  // Covers the lightweight claim flow that auto-fills the fallback location.
  test("GET /devices/claim creates a fallback-location device secret", async () => {
    const { app, db } = await buildApiApp({
      users: [owner],
    });

    const response = await app.inject({
      method: "GET",
      url: "/devices/claim",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      deviceId: expect.stringMatching(/^dev_/),
      deviceSecret: expect.stringMatching(/^esg1\./),
    });
    expect(db.devices).toHaveLength(1);
    expect(db.devices[0]).toEqual(
      expect.objectContaining({
        owner_uid: owner.id,
        status: "active",
        is_location_unknown: true,
      })
    );

    await app.close();
  });

  // Exercises the named claim flow with explicit location input.
  test("POST /devices/claim creates a named device", async () => {
    const { app, db } = await buildApiApp({
      users: [owner],
    });

    const response = await app.inject({
      method: "POST",
      url: "/devices/claim",
      payload: {
        name: "New Node",
        description: "Corner deployment",
        latitude: 29.6516,
        longitude: -82.3248,
        locationLabel: "University Ave",
        isLocationUnknown: false,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      deviceId: expect.stringMatching(/^dev_/),
      deviceSecret: expect.stringMatching(/^esg1\./),
    });
    expect(db.devices[0]).toEqual(
      expect.objectContaining({
        name: "New Node",
        description: "Corner deployment",
        location_label: "University Ave",
      })
    );

    await app.close();
  });

  // Confirms location updates return the normalized location payload.
  test("PUT /devices/:deviceId/location updates a device location", async () => {
    const { app } = await buildApiApp({
      users: [owner],
      devices: [
        {
          device_id: "dev_location",
          owner_uid: owner.firebase_uid,
          name: "Movable Device",
          description: "",
          status: "active",
          latitude: 29.6,
          longitude: -82.3,
          location_label: "Old spot",
          is_location_unknown: false,
        },
      ],
    });

    const response = await app.inject({
      method: "PUT",
      url: "/devices/dev_location/location",
      payload: {
        latitude: 29.7,
        longitude: -82.4,
        locationLabel: "Updated spot",
        isLocationUnknown: false,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      deviceId: "dev_location",
      latitude: 29.7,
      longitude: -82.4,
      locationLabel: "Updated spot",
      isLocationUnknown: false,
    });

    await app.close();
  });

  // Uses the real secret hashing helper so provisioning stays close to production behavior.
  test("POST /devices/provision returns Firebase credentials for a valid device", async () => {
    const rawSecret = "very-secret-device-token";
    const deviceCodeHash = devicesRoutes.helpers.createSecretHash(rawSecret);
    const ownerHint = Buffer.from(owner.firebase_uid, "utf8").toString("base64url");
    const { app, firebaseAuth } = await buildApiApp({
      users: [owner],
      devices: [
        {
          device_id: "dev_provision",
          owner_uid: owner.firebase_uid,
          device_code_hash: deviceCodeHash,
          status: "active",
        },
      ],
    });

    const response = await app.inject({
      method: "POST",
      url: "/devices/provision",
      payload: {
        deviceId: "dev_provision",
        deviceSecret: `esg1.${ownerHint}.${rawSecret}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      firebaseCustomToken: "token-for:device:dev_provision",
      firebaseUid: "device:dev_provision",
      deviceId: "dev_provision",
      ownerFirebaseUid: owner.firebase_uid,
      firebaseRootPath: `/users/${owner.firebase_uid}`,
      firebaseDevicePath: `/users/${owner.firebase_uid}/devices/dev_provision`,
    });
    expect(firebaseAuth.createCustomToken).toHaveBeenCalledWith(
      "device:dev_provision",
      expect.objectContaining({
        role: "device",
        device_id: "dev_provision",
        owner_uid: owner.firebase_uid,
      })
    );

    await app.close();
  });

  // Checks the revoke endpoint updates status and forwards revocation to Firebase auth.
  test("POST /devices/:deviceId/revoke marks a device as revoked", async () => {
    const { app, firebaseAuth } = await buildApiApp({
      users: [owner],
      devices: [
        {
          device_id: "dev_revoke",
          owner_uid: owner.firebase_uid,
          status: "active",
        },
      ],
    });

    const response = await app.inject({
      method: "POST",
      url: "/devices/dev_revoke/revoke",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        deviceId: "dev_revoke",
        status: "revoked",
      })
    );
    expect(firebaseAuth.revokeRefreshTokens).toHaveBeenCalledWith(
      "device:dev_revoke"
    );

    await app.close();
  });

  // Keeps delete coverage centered on endpoint behavior and cascading cleanup.
  test("DELETE /devices/:deviceId removes the device and its history", async () => {
    const { app, db, firebaseAuth } = await buildApiApp({
      users: [owner],
      devices: [
        {
          device_id: "dev_delete",
          owner_uid: owner.firebase_uid,
          status: "active",
        },
      ],
      deviceHistory: [
        {
          device_id: "dev_delete",
          owner_uid: owner.firebase_uid,
          sample_interval_start: "2026-04-20T12:00:00.000Z",
        },
      ],
    });

    const response = await app.inject({
      method: "DELETE",
      url: "/devices/dev_delete",
    });

    expect(response.statusCode).toBe(204);
    expect(db.devices).toHaveLength(0);
    expect(db.device_history).toHaveLength(0);
    expect(firebaseAuth.deleteUser).toHaveBeenCalledWith("device:dev_delete");

    await app.close();
  });
});
