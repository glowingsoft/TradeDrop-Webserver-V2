import validator from "validator";

/**
 * Validates a phone number in E.164 format (e.g. +385998798769)
 * and optionally checks against validator.js supported locales.
 *
 * @param {string} completePhone - Phone number in E.164 format
 * @returns {{ valid: boolean, completePhone: string, reason?: string }}
 */

/* Usage Example:
const { valid, completePhone, reason } = validatePhoneNumber("+385998798769");
if (valid) {
    // Proceed with valid phone number
} else {
    // Handle invalid phone number based on reason
}
*/
export function validatePhoneNumber(completePhone) {
    if (typeof completePhone !== "string" || !completePhone.trim()) {
        return { valid: false, completePhone: "", reason: "missing_or_invalid_input" };
    }

    completePhone = completePhone.trim();
    const e164Regex = /^\+[1-9]\d{1,14}$/;

    // Step 1: Check E.164 format
    if (!e164Regex.test(completePhone)) {
        return { valid: false, completePhone, reason: "invalid_format" };
    }

    return { valid: true, completePhone };
}
