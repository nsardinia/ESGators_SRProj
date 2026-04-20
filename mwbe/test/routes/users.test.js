jest.mock("../../src/lib/firebaseUserAuth", () => ({
  verifyFirebaseUser: jest.fn(),
}));

const { buildApiApp } = require("../support/apiHarness");

describe("user endpoints", () => {
  // Shared persisted user fixture for the CRUD response tests.
  const existingUser = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "owner@example.com",
    name: "Owner",
    firebase_uid: "firebase-owner-1",
    created_at: "2026-04-20T12:00:00.000Z",
    updated_at: "2026-04-20T12:00:00.000Z",
  };

  // Covers the list endpoint with the simplest persisted-user shape.
  test("GET /users lists users", async () => {
    const { app } = await buildApiApp({
      users: [existingUser],
    });

    const response = await app.inject({
      method: "GET",
      url: "/users",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      users: [existingUser],
    });

    await app.close();
  });

  // Confirms ID lookup returns the wrapped single-user response body.
  test("GET /users/:id returns a single user", async () => {
    const { app } = await buildApiApp({
      users: [existingUser],
    });

    const response = await app.inject({
      method: "GET",
      url: `/users/${existingUser.id}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: existingUser,
    });

    await app.close();
  });

  // Exercises the create path and the harness-generated persisted fields.
  test("POST /users creates a user", async () => {
    const { app, db } = await buildApiApp();

    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: {
        email: "new@example.com",
        name: "New User",
        firebaseUid: "firebase-new-user",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      user: expect.objectContaining({
        email: "new@example.com",
        name: "New User",
        firebase_uid: "firebase-new-user",
      }),
    });
    expect(db.users).toHaveLength(1);

    await app.close();
  });

  // Verifies the endpoint returns the updated user payload after mutation.
  test("PUT /users/:id updates a user", async () => {
    const { app } = await buildApiApp({
      users: [existingUser],
    });

    const response = await app.inject({
      method: "PUT",
      url: `/users/${existingUser.id}`,
      payload: {
        email: "owner+updated@example.com",
        name: "Updated Owner",
        firebaseUid: "firebase-owner-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      user: expect.objectContaining({
        id: existingUser.id,
        email: "owner+updated@example.com",
        name: "Updated Owner",
        firebase_uid: "firebase-owner-1",
      }),
    });

    await app.close();
  });

  // Keeps delete coverage focused on the HTTP response and backing record removal.
  test("DELETE /users/:id removes a user", async () => {
    const { app, db } = await buildApiApp({
      users: [existingUser],
    });

    const response = await app.inject({
      method: "DELETE",
      url: `/users/${existingUser.id}`,
    });

    expect(response.statusCode).toBe(204);
    expect(db.users).toHaveLength(0);

    await app.close();
  });
});
