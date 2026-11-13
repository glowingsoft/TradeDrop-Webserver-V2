const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");

const serviceAccountPath = path.join(__dirname, "../secretAssets/serviceAccountKey.json");
const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
const hasEnvCredentials = FIREBASE_PROJECT_ID || FIREBASE_CLIENT_EMAIL || FIREBASE_PRIVATE_KEY;

try {
  if (!admin.apps.length) {
    let serviceAccount;
    if (hasEnvCredentials) {
      if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
        throw new Error("FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY are required together");
      }
      serviceAccount = {
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      };
    } else if (fs.existsSync(serviceAccountPath)) {
      serviceAccount = require(serviceAccountPath);
    } else {
      throw new Error("Firebase service account credentials are not configured");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      ...(process.env.FIREBASE_DATABASE_URL
        ? { databaseURL: process.env.FIREBASE_DATABASE_URL }
        : !hasEnvCredentials ? { databaseURL: "https://tradedrop-50810.firebaseio.com" } : {}),
    });
  }
} catch (error) {
  console.error("Firebase Admin SDK initialization failed:", error.message);
}

module.exports = admin;
