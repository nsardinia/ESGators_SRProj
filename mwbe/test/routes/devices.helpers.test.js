const devicesRoutes = require("../../src/routes/devices");

describe("devices route helpers", () => {
  test("device secret helpers create verifiable hashes", () => {
    const secret = devicesRoutes.helpers.generateDeviceSecret();
    const encodedHash = devicesRoutes.helpers.createSecretHash(secret);

    expect(typeof encodedHash).toBe("string");
    expect(encodedHash.startsWith("scrypt$")).toBe(true);
    expect(devicesRoutes.helpers.verifySecret(secret, encodedHash)).toBe(true);
    expect(devicesRoutes.helpers.verifySecret("wrong-secret", encodedHash)).toBe(false);
  });

  test("isUuid only accepts valid UUID values", () => {
    expect(devicesRoutes.helpers.isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(devicesRoutes.helpers.isUuid("not-a-uuid")).toBe(false);
    expect(devicesRoutes.helpers.isUuid("dev_123")).toBe(false);
  });
});
