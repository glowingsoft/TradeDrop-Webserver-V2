const express = require("express");
const {
  sendResponse,
  validateParams,
} = require("../../helperUtils/responseUtil");
const router = express.Router();

const auth = require("../../middlewares/authMiddleware");
const { User } = require("@UsersModel");



// ✅ Base web URL for universal links
const BASE_WEB_URL = process.env.API_BASE_URL;

/**
 * Helper to generate one universal share URL
 * Example: https://pleisapp.com/open?type=event&id=XYZabc123
 */
function generateShareLink(user, objectId, objectType) {
  return `${BASE_WEB_URL}app/share?id=${user}&objectId=${objectId}&objectType=${objectType}`;
}
router.use(auth);
/**
 * ✅ Generate shareable link
 * Example: GET /api/share/event/68ff18ed8cd2d2f52b25be1a
 * Uses Mongo _id (uuid) → returns link with publicId
 */
router.get("/:objectType/:objectId", async (req, res) => {
  try {
    const { objectType, objectId } = req.params;
    const user=req.user._id

    if (!objectType || !objectId) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "object_type_and_id_required",
      });
    }

    const allowedTypes = ["user", "coach", "service"];

    if (!allowedTypes.includes(objectType)) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "invalid_object_type",
      });
    }

    if (objectType === "user" || objectType === "coach") {
      const user = await User.findById(objectId);

      if (!user) {
        return sendResponse({
          res,
          statusCode: 404,
          translationKey: "object_not_found",
        });
      }

      const userType = user?.accountState?.userType;

      if (objectType === "coach" && userType !== "coach") {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "object_not_found",
        });
      }

      if (objectType === "user" && userType !== "user") {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "object_not_found",
        });
      }
    }

    const shareUrl = generateShareLink(user,objectId, objectType);
         
    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "share_link_generated_successfully",
      data: {
        shareUrl,
      },
    });
  } catch (err) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
      error: err,
    });
  }
});

router.get("/share", async (req, res) => {
  try {
    const { id, objectId, objectType } = req.query;

    if (!id || !objectId || !objectType) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "invalid_request",
      });
    }

    // Save referral if needed
    await saveUserReferralData(id, req.ip);

    // Deep link for app
    const appLink = `tradedrop://share?objectId=${objectId}&objectType=${objectType}&referrer=${id}`;

    const iosFallback = "https://apps.apple.com/app/tradedrop/id1234567890";

    const androidFallback =
      "https://play.google.com/store/apps/details?id=com.tradedrop";

    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Opening TradeDrop...</title>
          <script>
            function openApp() {
              const appLink = '${appLink}';
              const iosFallback = '${iosFallback}';
              const androidFallback = '${androidFallback}';

              const userAgent =
                navigator.userAgent ||
                navigator.vendor ||
                window.opera;

              window.location = appLink;

              setTimeout(() => {
                if (/android/i.test(userAgent)) {
                  window.location = androidFallback;
                } else if (
                  /iPad|iPhone|iPod/.test(userAgent) &&
                  !window.MSStream
                ) {
                  window.location = iosFallback;
                } else {
                  window.location = 'https://tradedrop.com';
                }
              }, 1500);
            }

            window.onload = openApp;
          </script>
        </head>
        <body>
          <p style="text-align:center;margin-top:40vh;font-family:sans-serif;">
            Opening TradeDrop...
          </p>
        </body>
      </html>
    `);
  } catch (err) {
    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "internal_server_error",
      error: err,
    });
  }
});


module.exports = router;
