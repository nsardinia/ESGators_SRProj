const registerPlugins = require("../../src/plugins");

describe("buildCorsOrigin", () => {
  afterEach(() => {
    delete process.env.CORS_ORIGIN;
  });

  test("allows all origins when CORS_ORIGIN is unset", () => {
    delete process.env.CORS_ORIGIN;

    expect(registerPlugins.buildCorsOrigin()).toBe(true);
  });

  test("accepts configured origins and rejects others", async () => {
    process.env.CORS_ORIGIN = "https://example.com, https://dashboard.example.com";

    const originHandler = registerPlugins.buildCorsOrigin();

    await new Promise((resolve, reject) => {
      originHandler("https://example.com", (error, allowed) => {
        try {
          expect(error).toBeNull();
          expect(allowed).toBe(true);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });

    await new Promise((resolve, reject) => {
      originHandler("https://blocked.example.com", (error, allowed) => {
        try {
          expect(error).toBeInstanceOf(Error);
          expect(error.message).toBe("Origin not allowed by CORS");
          expect(allowed).toBe(false);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      });
    });
  });
});
