// emailTemplate.js
const APP_NAME = "TradeDrop App"; // Define the app name as a constant at the top
const currentYear = new Date().getFullYear(); // Dynamically get the current year

const OTP_PURPOSE_CONFIG = {
  signup: {
    subject: `Welcome to ${APP_NAME}`,
    title: `Welcome to ${APP_NAME}`,
    message: "Use the OTP below to complete your registration.",
  },
  forgot_password: {
    subject: "Password Reset OTP",
    title: "Password Reset Request",
    message: `We received a request to reset your password for your ${APP_NAME} account.`,
  },
  login: {
    subject: "Login Verification OTP",
    title: "Login Verification",
    message: "Use the OTP below to log in to your account.",
  },
  generic: {
    subject: "Your Verification Code",
    title: "Verification Code",
    message: "Use the OTP below to proceed.",
  },
};


// Function to generate Registration link email template
const registrationViaLinkEmailTemplate = (verificationLink) => `
 <!DOCTYPE html>
<html>
  <head>
    <style>
      .email-container {
        font-family: Arial, sans-serif;
        line-height: 1.5;
        color: #333;
      }
      .email-header {
        background-color: #60c0f7;
        color: white;
        text-align: center;
        padding: 10px 0;
        color: #ffffff;
      }
        .email-header h2 {
        color: white;
        margin: 0;
      }
      .email-body {
        margin: 20px;
      }
      .verify-link {
        display: inline-block;
        padding: 10px 20px;
        margin: 15px 0;
        background-color: #60c0f7;
        color: white;
        text-decoration: none;
        border-radius: 5px;
        font-weight: bold;
      }
      .footer {
        text-align: center;
        margin-top: 20px;
        color: #888;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <h2>Welcome to ${APP_NAME}</h2>
      </div>
      <div class="email-body">
        <p>Hello,</p>
        <p>Thank you for registering with us. Please click the button below to verify your email and complete your registration:</p>
        <p>
           <a href="${verificationLink}" 
             style="
               display:inline-block; 
               padding:10px 20px; 
               background-color:#60c0f7; 
               color:#ffffff !important; 
               text-decoration:none !important; 
               border-radius:5px; 
               font-weight:bold;
             ">
            Verify Email
          </a>
        </p>
        <p>If you didn't initiate this request, please ignore this email.</p>
      </div>
      <div class="footer">
        &copy; ${currentYear} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  </body>
</html>

`;

const registrationViaOtpEmailTemplate = (otp) => `
<!DOCTYPE html>
<html>
  <head>
    <style>
      .email-container {
        font-family: Arial, sans-serif;
        line-height: 1.5;
        color: #333;
      }
      .email-header {
        background-color: #60c0f7;
        color: white;
        text-align: center;
        padding: 10px 0;
      }
        .email-header h2 {
        color: white;
        margin: 0;
      }
      .email-body {
        margin: 20px;
      }
      .otp-code {
        display: inline-block;
        padding: 15px 25px;
        margin: 15px 0;
        background-color: #60c0f7;
        color: white;
        font-size: 24px;
        font-weight: bold;
        letter-spacing: 4px;
        border-radius: 5px;
        text-align: center;
      }
      .footer {
        text-align: center;
        margin-top: 20px;
        color: #888;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <h2>Welcome to ${APP_NAME}</h2>
      </div>
      <div class="email-body">
        <p>Hello,</p>
        <p>Thank you for registering with us. Use the OTP below to complete your registration:</p>
        <div class="otp-code">${otp}</div>
        <p>This OTP is valid for 10 minutes. If you didn't initiate this request, please ignore this email.</p>
      </div>
      <div class="footer">
        &copy; ${currentYear} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  </body>
</html>
`;


// Function to generate Forgot Password Verification Link email template
const forgotPasswordViaLinkEmailTemplate = (resetLink) => `
<!DOCTYPE html>
<html>
  <head>
    <style>
      .email-container {
        font-family: Arial, sans-serif;
        line-height: 1.5;
        color: #333;
      }
      .email-header {
        background-color: #60c0f7;
        color: white;
        text-align: center;
        padding: 10px 0;
      }
        .email-header h2 {
        color: white;
        margin: 0;
      }
      .email-body {
        margin: 20px;
      }
      .verify-link {
        display: inline-block;
        padding: 10px 20px;
        margin: 15px 0;
        background-color: #60c0f7;
        color: white;
        text-decoration: none;
        border-radius: 5px;
        font-weight: bold;
      }
      .footer {
        text-align: center;
        margin-top: 20px;
        color: #888;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <h2>Password Reset Request</h2>
      </div>
      <div class="email-body">
        <p>Hello,</p>
        <p>We received a request to reset your password for your account at ${APP_NAME}. Please click the button below to reset your password:</p>
        <p>
           <a href="${resetLink}" 
             style="
               display:inline-block; 
               padding:10px 20px; 
               background-color:#60c0f7; 
               color:#ffffff !important; 
               text-decoration:none !important; 
               border-radius:5px; 
               font-weight:bold;
             ">
            Reset Password
          </a>
        </p>
        <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
      </div>
      <div class="footer">
        &copy; ${currentYear} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  </body>
</html>
`;


const forgotPasswordViaOtpEmailTemplate = (otp) => `
<!DOCTYPE html>
<html>
  <head>
    <style>
      .email-container {
        font-family: Arial, sans-serif;
        line-height: 1.5;
        color: #333;
      }
      .email-header {
        background-color: #60c0f7;
        color: white;
        text-align: center;
        padding: 10px 0;
      }
      .email-header h2 {
        color: white;
        margin: 0;
      }
      .email-body {
        margin: 20px;
      }
      .otp-code {
        display: inline-block;
        padding: 15px 25px;
        margin: 15px 0;
        background-color: #60c0f7;
        color: white;
        font-size: 24px;
        font-weight: bold;
        letter-spacing: 4px;
        border-radius: 5px;
        text-align: center;
      }
      .footer {
        text-align: center;
        margin-top: 20px;
        color: #888;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <h2>Password Reset Request</h2>
      </div>
      <div class="email-body">
        <p>Hello,</p>
        <p>We received a request to reset your password for your account at ${APP_NAME}. Use the OTP below to reset your password:</p>
        <div class="otp-code">${otp}</div>
        <p>This OTP is valid for 10 minutes. If you didn't request this, please ignore this email.</p>
      </div>
      <div class="footer">
        &copy; ${currentYear} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  </body>
</html>
`;

const otpEmailTemplate = ({ otp, title, message }) => `
<!DOCTYPE html>
<html>
  <head>
    <style>
      .email-container {
        font-family: Arial, sans-serif;
        line-height: 1.5;
        color: #333;
      }
      .email-header {
        background-color: #60c0f7;
        color: white;
        text-align: center;
        padding: 10px 0;
      }
      .email-header h2 {
        color: white;
        margin: 0;
      }
      .email-body {
        margin: 20px;
      }
      .otp-code {
        display: inline-block;
        padding: 15px 25px;
        margin: 15px 0;
        background-color: #60c0f7;
        color: white;
        font-size: 24px;
        font-weight: bold;
        letter-spacing: 4px;
        border-radius: 5px;
        text-align: center;
      }
      .footer {
        text-align: center;
        margin-top: 20px;
        color: #888;
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="email-header">
        <h2>${title}</h2>
      </div>
      <div class="email-body">
        <p>Hello,</p>
        <p>${message}</p>
        <div class="otp-code">${otp}</div>
        <p>This OTP is valid for 10 minutes. If you didn’t request this, please ignore this email.</p>
      </div>
      <div class="footer">
        &copy; ${currentYear} ${APP_NAME}. All rights reserved.
      </div>
    </div>
  </body>
</html>
`;



/**
 * Generates an account status email template based on user status.
 * @param {string} status - One of: pending, active, rejected, suspended, deleted
 * @param {string} userName - The user's name
 * @returns {string} - HTML email template
 */

// const html = accountStatusEmailTemplate('active', 'John Doe');
// then send `html` via your email service


const accountStatusEmailTemplate = (status, userName) => {
  let statusMessage = '';
  let headerText = '';

  switch (status.toLowerCase()) {
    case 'active':
      statusMessage = 'Congratulations! Your account has been activated. You can now access all features of your account.';
      headerText = 'Account Activated';
      break;
    case 'pending':
      statusMessage = 'Your account is pending verification. Please complete any required steps to activate your account.';
      headerText = 'Account Pending';
      break;
    case 'rejected':
      statusMessage = 'We are sorry. Your account verification request has been rejected. Please contact support for more details.';
      headerText = 'Account Rejected';
      break;
    case 'suspended':
      statusMessage = 'Your account has been suspended due to policy violations. Please contact support for assistance.';
      headerText = 'Account Suspended';
      break;
    case 'deleted':
      statusMessage = 'Your account has been deleted. If you believe this is a mistake, please contact our support team.';
      headerText = 'Account Deleted';
      break;
    default:
      statusMessage = `Your account status has been updated to "${status}". Please contact support for more details.`;
      headerText = 'Account Status Update';
  }

  const currentYear = new Date().getFullYear();
  const headerBgColor = '#60c0f7';
  const headerTextColor = '#ffffff';
  const footerColor = '#888888';

  return `
  <!DOCTYPE html>
  <html>
    <body style="margin:0; padding:0; font-family: Arial, sans-serif; line-height: 1.5; color: #333;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" bgcolor="${headerBgColor}" style="padding: 10px 0; color: ${headerTextColor};">
            <h2 style="margin:0; font-size:24px;">${headerText}</h2>
          </td>
        </tr>
        <tr>
          <td>
            <table width="600" align="center" cellpadding="0" cellspacing="0" style="margin:20px auto;">
              <tr>
                <td>
                  <p>Hello ${userName},</p>
                  <p style="font-size: 1.2em; margin: 15px 0;">${statusMessage}</p>
                  <p>If you have any questions, please contact our support team.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 20px 0; color: ${footerColor}; font-size: 12px;">
            &copy; ${currentYear} ${APP_NAME}. All rights reserved.
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;
};


const menuOrderConfirmationEmailTemplate = ({
  userName,
  order,
  organizationName,
  currency = "EUR",
}) => {

  const currentYear = new Date().getFullYear();

  const formatPrice = (amount) =>
    `${currency} ${Number(amount || 0).toFixed(2)}`;

  const itemsRows = order.items
    .map((item) => {
      const title = item.menuItemSnapShot?.title || "Item";
      const quantity = item.quantity || 1;
      const finalPrice = item.finalPrice || 0;

      return `
        <tr>
          <td style="padding:12px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="40"><strong>${quantity} ×</strong></td>
                <td>${title}</td>
                <td align="right"><strong>${formatPrice(finalPrice)}</strong></td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
    </head>
    <body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;color:#333;">
      
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">

            <!-- Main Wrapper -->
            <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;margin:20px auto;border-radius:8px;overflow:hidden;">
              
              <!-- Header -->
              <tr>
                <td align="center" style="background:#60c0f7;color:#ffffff;padding:20px;">
                  <h2 style="margin:0;">Order Confirmed</h2>
                </td>
              </tr>

              <!-- Greeting -->
              <tr>
                <td style="padding:20px;">
                  <p>Hello ${userName || "Customer"},</p>
                  <p>Your order from <strong>${organizationName}</strong> has been confirmed.</p>
                </td>
              </tr>

              <!-- Order Details Box -->
              <tr>
                <td style="padding:0 20px 20px 20px;">
                  <table width="100%" cellpadding="10" cellspacing="0" style="border:1px solid #eeeeee;border-radius:6px;">
                    <tr>
                      <td width="40%" bgcolor="#f7f7f7"><strong>Order Number</strong></td>
                      <td>${order.orderNumber}</td>
                    </tr>
                    <tr>
                      <td bgcolor="#f7f7f7"><strong>Order Date</strong></td>
                      <td>${new Date(order.createdAt).toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td bgcolor="#f7f7f7"><strong>Pickup Type</strong></td>
                      <td>${order.pickupType}</td>
                    </tr>
                    ${order.pickupType === "tableService"
      ? `
                    <tr>
                      <td bgcolor="#f7f7f7"><strong>Table Number</strong></td>
                      <td>${order.tableNumber}</td>
                    </tr>
                    `
      : ""
    }
                  </table>
                </td>
              </tr>

              <!-- Ordered Items -->
              <tr>
                <td style="padding:0 20px;">
                  <h3 style="margin-bottom:10px;">Ordered Items</h3>
                </td>
              </tr>

              <tr>
                <td style="padding:0 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;">
                    ${itemsRows}
                  </table>
                </td>
              </tr>

              <!-- Total -->
              <tr>
                <td style="padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eeeeee;padding-top:10px;">
                    <tr>
                      <td align="left"><strong>Order Total</strong></td>
                      <td align="right" style="font-size:18px;">
                        <strong>${formatPrice(order.totalPrice)}</strong>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td align="center" style="padding:20px;color:#888;font-size:12px;">
                  &copy; ${currentYear} ${APP_NAME}. All rights reserved.
                </td>
              </tr>

            </table>

          </td>
        </tr>
      </table>

    </body>
  </html>
  `;
};

// Export both functions
module.exports = {
  registrationViaLinkEmailTemplate,
  registrationViaOtpEmailTemplate,
  forgotPasswordViaLinkEmailTemplate,
  forgotPasswordViaOtpEmailTemplate,
  accountStatusEmailTemplate,
  otpEmailTemplate,
  OTP_PURPOSE_CONFIG,
  menuOrderConfirmationEmailTemplate
};
