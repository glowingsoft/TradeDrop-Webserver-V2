const fs = require("fs");
const path = require("path");
const logger = require("./helperUtils/logger");

// Path to base language file
const baseLangFile = path.join(__dirname, "assets", "locales", "en.json");

// Paths to output files
const missingFile = path.join(__dirname, "missingTranslations.json");
const extraFile = path.join(__dirname, "extraTranslations.json");

// Root folder to scan for translationKey usage
const rootDir = __dirname;
const modelsDir = path.join(__dirname, "models");

// Load base translations JSON (en.json)
let baseTranslations = {};
try {
  baseTranslations = JSON.parse(fs.readFileSync(baseLangFile, "utf-8"));
} catch (err) {
  console.error("Failed to read base language file:", err);
  process.exit(1);
}

// Helper: Recursively scan files in directory
function scanFiles(dir) {
  let results = [];
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      results = results.concat(scanFiles(fullPath));
    } else if (
      /\.(js|ts|jsx|tsx|json|mjs|cjs)$/.test(file.name) &&
      !fullPath.includes("node_modules")
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

// Extract translation keys used via translationKey: "key" or translationKey = "key"
function extractTranslationKeys(content) {
  const keys = new Set();

  // Match translationKey: "key" or translationKey: 'key'
  const colonRegex = /translationKey\s*:\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = colonRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }

  // Match translationKey = "key" or translationKey = 'key'
  const equalsRegex = /translationKey\s*=\s*['"]([^'"]+)['"]/g;
  while ((match = equalsRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }

  return Array.from(keys);
}

// Extract message keys like: required: [true, "email_required"] or message: "email_invalid"
function extractSchemaValidationKeys(content) {
  const keys = new Set();
  const requiredRegex = /required\s*:\s*\[\s*true\s*,\s*["']([^"']+)["']\s*\]/g;
  const messageRegex = /message\s*:\s*["']([^"']+)["']/g;

  let match;
  while ((match = requiredRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  while ((match = messageRegex.exec(content)) !== null) {
    keys.add(match[1]);
  }

  return Array.from(keys);
}

// Helper: Convert key to readable default translation
function keyToReadableText(key) {
  const withSpaces = key.replace(/[_\.]+/g, " ");
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

(async () => {
  logger.log("Scanning files...");

  const allFiles = scanFiles(rootDir);
  const foundKeys = new Set();

  for (const filePath of allFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");

      // Extract translationKey values
      extractTranslationKeys(content).forEach((k) => foundKeys.add(k));

      // Only apply schema validation extraction to files in models folder
      if (filePath.startsWith(modelsDir)) {
        extractSchemaValidationKeys(content).forEach((k) => foundKeys.add(k));
      }
    } catch (err) {
      console.warn("Could not read file", filePath);
    }
  }

  logger.log(`Total translation keys found: ${foundKeys.size}`);

  // Find missing keys
  const missingKeys = {};
  foundKeys.forEach((key) => {
    if (!(key in baseTranslations)) {
      missingKeys[key] = keyToReadableText(key);
      baseTranslations[key] = missingKeys[key];
    }
  });

  // Find extra keys
  const extraKeys = {};
  Object.keys(baseTranslations).forEach((key) => {
    if (!foundKeys.has(key)) {
      extraKeys[key] = baseTranslations[key];
      delete baseTranslations[key];
    }
  });

  // Write updates
  fs.writeFileSync(baseLangFile, JSON.stringify(baseTranslations, null, 2), "utf-8");
  fs.writeFileSync(missingFile, JSON.stringify(missingKeys, null, 2), "utf-8");
  fs.writeFileSync(extraFile, JSON.stringify(extraKeys, null, 2), "utf-8");

  logger.log(`Updated ${baseLangFile}`);
  logger.log(`📁 Missing keys saved to: ${missingFile}`);
  logger.log(`🧹 Extra keys saved to: ${extraFile}`);
})();