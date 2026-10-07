const axios = require("axios");

const BREVO_API_KEY = "bskicZzXBg7iyRV";

async function sendTestEmail() {
  try {
    console.log("Inside Brevo email");
    console.log(BREVO_API_KEY, "BREVO_API_KEY");
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "Calivo App",
          email: "support@calivoapp.com",
        },
        to: [
          {
            email: "nabeel.glowingsoft@gmail.com",
            name: "Test User",
          },
        ],
        subject: "Brevo Test Email",
        htmlContent: `
          <h1>Brevo Test 🚀</h1>
          <p>This is a test email sent using the Brevo API and Axios.</p>
          <p>If you received this, your Brevo setup is working.</p>
        `,
      },
      {
        headers: {
          "api-key": BREVO_API_KEY,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    );

    console.log("Email sent successfully:", response.data);
  } catch (error) {
    console.error("Brevo error:", error.response?.data || error.message);
  }
}
async function testBrevoKey() {
  try {
    const response = await axios.get("https://api.brevo.com/v3/account", {
      headers: {
        "api-key": BREVO_API_KEY,
        Accept: "application/json",
      },
    });

    console.log("Brevo API key is valid!");
    console.log(response.data);
  } catch (error) {
    console.error("Brevo auth error:", error.response?.status, error.response?.data || error.message);
  }
}
// testBrevoKey();

// sendTestEmail();

module.exports = {
  sendTestEmail,
};
