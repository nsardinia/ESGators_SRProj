"use strict";

function ensureFirebaseAuth(app) {
  if (!app.hasDecorator("firebaseAuth")) {
    throw app.httpErrors.internalServerError(
      "Firebase authentication is not configured. Set Firebase env vars and install firebase-admin."
    );
  }
}

function getBearerToken(request) {
  const authorizationHeader = request.headers.authorization;

  if (!authorizationHeader) {
    throw request.server.httpErrors.unauthorized("Missing Authorization bearer token");
  }

  const [scheme, token] = authorizationHeader.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw request.server.httpErrors.unauthorized("Malformed Authorization bearer token");
  }

  return token;
}

async function verifyFirebaseUser(app, request) {
  ensureFirebaseAuth(app);

  let decodedToken;

  try {
    decodedToken = await app.firebaseAuth.verifyIdToken(getBearerToken(request));
  } catch (error) {
    throw request.server.httpErrors.unauthorized("Invalid Firebase ID token");
  }

  if (!decodedToken?.uid || decodedToken.role === "device") {
    throw request.server.httpErrors.forbidden("Only signed-in users can access this resource");
  }

  return decodedToken;
}

module.exports = {
  ensureFirebaseAuth,
  verifyFirebaseUser,
};
