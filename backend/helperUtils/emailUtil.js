var SibApiV3Sdk = require("sib-api-v3-sdk");

const sendEmailViaBrevo = async (emails, subject, body, config = {}) => {
  return;

  console.debug("🚀 ~ sendEmailViaBrevo ~ emails:", emails);
  var defaultClient = SibApiV3Sdk.ApiClient.instance;
  // Get the API key
  var apiKey = defaultClient.authentications["api-key"];
  apiKey.apiKey = process.env.BREVO_EMAIL_API_KEY; // Use the environment variable for the API key

  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  // Initial assignment from parameters
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = body;
  sendSmtpEmail.sender = { email: "noreply@tradedrop.com", name: "TradeDrop" };

  // Ensure to field is dynamically updated
  sendSmtpEmail.to = emails.map((email) => ({ email }));
  try {
    // Send email
    //  const data = await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.debug("🚀 ~ sendEmailViaBrevo ~ data:", "sendbox mails");
  } catch (error) {
    console.error("Error sending email:", error);
    // throw new Error (error.response.body)
  }
};

module.exports = {
  sendEmailViaBrevo,
};
