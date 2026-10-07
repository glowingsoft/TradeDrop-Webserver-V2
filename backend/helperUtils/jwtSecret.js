const crypto = require('crypto');

// Function to generate a secure JWT secret
function generateJWTSecret(length = 64) {
    return crypto.randomBytes(length).toString('hex'); // Generate random secret as a hexadecimal string
}

// Generate the secret
const jwtSecret = generateJWTSecret(64); // 64 bytes = 128 characters in hex
console.log('Your JWT_SECRET:', jwtSecret);

// Import the jsonwebtoken library
//to generate token >>>>>>>>>>>>>>>>>>>>>>> node generateToken.js
const jwt = require('jsonwebtoken');

// Define your secret key (it should be the same as your JWT secret or a separate one for admin tokens)
const secretKey = jwtSecret // Replace this with your actual JWT secret
//console.log("====>secretKey",secretKey)
// Define the payload for the admin creation token
const payload = {
  role: 'admin-creation',
};

// Define options for the token, such as expiration
const options = {
  expiresIn: '1h', // Token will be valid for 1 hour
};

// Generate the token
const adminCreationToken = jwt.sign(payload, secretKey, options);

// Output the token
console.log('Generated Token:', adminCreationToken);

