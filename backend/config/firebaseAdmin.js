const admin = require("firebase-admin");
const fs = require('fs');
const path = require('path');

const folderPath = path.join(__dirname, '../secretAssets');
const filePath = path.join(folderPath, 'serviceAccountKey.json');

// Create folder if it doesn't exist
if (!fs.existsSync(folderPath)) {
  fs.mkdirSync(folderPath, { recursive: true });
}

// Create file if it doesn't exist
if (!fs.existsSync(filePath)) {
  fs.writeFileSync(filePath, '{}'); // Creates an empty JSON file
}

const serviceAccount = require("../secretAssets/serviceAccountKey.json");

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://tradedrop-50810.firebaseio.com",
  });

  // Log after successful initialization
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  // Log any errors during initialization
  console.error('❌ Error initializing Firebase Admin SDK');
}
module.exports = admin;

