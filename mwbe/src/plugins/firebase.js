/**
 * Firebase configuration handled as fastify plugin. Allows all backend routes to interface with firebase using 
 * service keys stored in firebaseServiceKeys.json (not public). Creates firebase connections.
 * 
 * Last Edit: Nicholas Sardinia, 3/1/2026
 */
const fs = require("node:fs");
const path = require("node:path");

function normalizePrivateKey(privateKey) {
  return String(privateKey || "").replace(/\\n/g, "\n");
}

function readServiceAccountFromEnv() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

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
  let serviceAccount;

  try {
    serviceAccount = readServiceAccountFromEnv();
  } catch (error) {
    app.log.warn(
      { error },
      "Failed to parse Firebase service account from env. Firebase integration is disabled."
    );
    return;
  }

  if (!serviceAccount) {
    const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);

    if (!fs.existsSync(resolvedPath)) {
      app.log.warn(
        {
          serviceAccountPath: resolvedPath,
          expectedEnvVars: [
            "FIREBASE_SERVICE_ACCOUNT_JSON",
            "FIREBASE_PROJECT_ID",
            "FIREBASE_CLIENT_EMAIL",
            "FIREBASE_PRIVATE_KEY",
          ],
        },
        "Firebase credentials not found in env or service account file. Firebase integration is disabled."
      );
      return;
    }

    try {
      serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    } catch (error) {
      app.log.warn(
        { error, serviceAccountPath: resolvedPath },
        "Failed to parse Firebase service account file. Firebase integration is disabled."
      );
      return;
    }
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
