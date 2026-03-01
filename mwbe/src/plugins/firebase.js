/**
 * Firebase configuration handled as fastify plugin. Allows all backend routes to interface with firebase using 
 * service keys stored in firebaseServiceKeys.json (not public). Creates firebase connections.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
const fs = require("node:fs");
const path = require("node:path");

function registerFirebase(app) {
  let admin;

  try {
    admin = require("firebase-admin");
  } catch (error) {
    app.log.warn(
      "firebase-admin is not installed. Firebase integration is disabled until dependency is installed."
    );
    return;
  }

  const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "firebaseServiceKeys.json";
  const appName = process.env.FIREBASE_APP_NAME || "mwbe";
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);

  if (!fs.existsSync(resolvedPath)) {
    app.log.warn(
      { serviceAccountPath: resolvedPath },
      "Firebase service account file not found. Firebase integration is disabled."
    );
    return;
  }

  let serviceAccount;

  try {
    serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  } catch (error) {
    app.log.warn(
      { error },
      "Failed to parse Firebase service account file. Firebase integration is disabled."
    );
    return;
  }

  const hasNamedApp = admin.apps.some((existingApp) => existingApp.name === appName);
  const firebaseApp = hasNamedApp
    ? admin.app(appName)
    : admin.initializeApp(
        {
          credential: admin.credential.cert(serviceAccount),
          ...(databaseURL ? { databaseURL } : {}),
        },
        appName
      );

  app.decorate("firebaseAdmin", admin);
  app.decorate("firebaseAuth", firebaseApp.auth());

  if (databaseURL) {
    app.decorate("firebaseDb", firebaseApp.database());
  }
}

module.exports = registerFirebase;
