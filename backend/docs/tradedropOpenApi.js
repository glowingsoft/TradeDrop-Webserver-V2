/**
 * OpenAPI 3.0 — TradeDrop consumer APIs (implemented endpoints).
 * Served at GET /api/v1/docs
 */
module.exports = {
  openapi: "3.0.3",
  info: {
    title: "TradeDrop Consumer API",
    version: "1.0.0",
    description:
      "TradeDrop barter marketplace — consumer endpoints only.\n\n" +
      "**Base:** `/api/v1`\n\n" +
      "**Envelope:** `{ message, data, meta? }` via `sendResponse`.\n\n" +
      "**Auth:** `Authorization: Bearer <JWT>` unless marked public.\n\n" +
      "**Pagination:** cursor + `meta.nextCursor` on list endpoints (not page/limit).\n\n" +
      "**Not in this spec (deferred):** threads HTTP (API-050–053), block/report (API-061–063), " +
      "TradeDrop-shaped notifications read-all (API-059). Boilerplate `GET /notifications` exists separately.",
  },
  servers: [
    {
      url: "/api/v1",
      description: "Current host (dev default: http://localhost:4020/api/v1)",
    },
  ],
  tags: [
    { name: "Auth", description: "Register, login, OTP, password reset" },
    { name: "Catalog", description: "Categories, timing chips and app settings" },
    { name: "Profile", description: "Me, portfolio, onboarding, privacy" },
    { name: "Drops", description: "Drop CRUD and lifecycle" },
    { name: "Tap-ins", description: "Tap-in apply, accept, decline, withdraw" },
    { name: "Trades", description: "Complete flow and reviews" },
    { name: "Radar", description: "Discovery pins (approx geo)" },
    { name: "Public", description: "Public profiles" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Envelope: {
        type: "object",
        properties: {
          message: { type: "string" },
          data: {},
          meta: { type: "object" },
        },
      },
      RegisterBody: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          name: { type: "string" },
          handle: { type: "string", pattern: "^[a-z0-9_]{3,20}$" },
          timezone: { type: "string" },
        },
      },
      LoginBody: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string" },
          password: { type: "string" },
        },
      },
      OtpVerifyBody: {
        type: "object",
        required: ["email", "code", "purpose"],
        properties: {
          email: { type: "string" },
          code: { type: "string", pattern: "^\\d{4}$" },
          purpose: { type: "string", enum: ["signup", "password_reset"] },
        },
      },
      OtpResendBody: {
        type: "object",
        required: ["email", "purpose"],
        properties: {
          email: { type: "string" },
          purpose: { type: "string", enum: ["signup", "password_reset"] },
        },
      },
      PasswordForgotBody: {
        type: "object",
        required: ["email"],
        properties: { email: { type: "string" } },
      },
      PasswordResetBody: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string" },
          password: { type: "string", minLength: 8 },
          code: { type: "string" },
        },
      },
      DropCreateBody: {
        type: "object",
        required: ["concept", "needText", "offerText", "needCategoryId", "offerCategoryId", "timingChip", "areaLabel"],
        properties: {
          concept: { type: "string", maxLength: 120 },
          locationType: { type: "string", enum: ["neighborhood", "specific", "remote"] },
          referenceImages: { type: "array", items: { type: "string" }, maxItems: 10 },
          startTime: { type: "string", format: "date-time", nullable: true },
          endTime: { type: "string", format: "date-time", nullable: true },
          expiresIn: { type: "string", example: "24h", description: "24h, 3days, 1week (max 365 days)" },
          needText: { type: "string" },
          offerText: { type: "string" },
          needCategoryId: { type: "string" },
          offerCategoryId: { type: "string" },
          timingChip: {
            type: "string",
            description: "TimingChip.value from GET /api/v1/timing-chips",
          },
          areaLabel: { type: "string" },
          lat: { type: "number" },
          lng: { type: "number" },
          detail: { type: "string" },
          usageRights: { type: "string" },
          media: { type: "array", items: { type: "string" } },
        },
      },
      TapInCreateBody: {
        type: "object",
        required: ["yourOffer", "availability"],
        properties: {
          yourOffer: { type: "string" },
          availability: { type: "string" },
          link: { type: "string" },
          note: { type: "string", maxLength: 280 },
          media: { type: "array", items: { type: "string" }, maxItems: 6 },
        },
      },
      ReviewBody: {
        type: "object",
        required: ["stars"],
        properties: {
          stars: { type: "integer", minimum: 1, maximum: 5 },
          body: { type: "string", maxLength: 400 },
        },
      },
      PrivacyPatch: {
        type: "object",
        properties: {
          radarVisible: { type: "boolean" },
          hideFromSearch: { type: "boolean" },
          openToTrade: { type: "boolean" },
        },
      },
    },
  },
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register (API-001)",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/RegisterBody" } },
          },
        },
        responses: { 201: { description: "Created; may include debugOtp in dev" } },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login (API-002)",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LoginBody" } },
          },
        },
        responses: { 200: { description: "JWT token in data" } },
      },
    },
    "/auth/otp/verify": {
      post: {
        tags: ["Auth"],
        summary: "Verify OTP (API-003)",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/OtpVerifyBody" } },
          },
        },
        responses: { 200: { description: "Verified" } },
      },
    },
    "/auth/otp/resend": {
      post: {
        tags: ["Auth"],
        summary: "Resend OTP (API-004)",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/OtpResendBody" } },
          },
        },
        responses: { 200: { description: "OTP resent (30s cooldown)" } },
      },
    },
    "/auth/password/forgot": {
      post: {
        tags: ["Auth"],
        summary: "Forgot password — send OTP (API-005)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PasswordForgotBody" },
            },
          },
        },
        responses: { 200: { description: "OTP sent if account exists" } },
      },
    },
    "/auth/password/reset": {
      post: {
        tags: ["Auth"],
        summary: "Reset password with OTP (API-006)",
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/PasswordResetBody" } },
          },
        },
        responses: { 200: { description: "Password updated" } },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Refresh JWT (API-007)",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "New token" } },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Logout (API-008)",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Logged out" } },
      },
    },
    "/categories": {
      get: {
        tags: ["Catalog"],
        summary: "List categories (API-010)",
        responses: { 200: { description: "Active launch categories" } },
      },
    },
    "/drops": {
      get: {
        tags: ["Drops"],
        summary: "List active drops (API-012)",
        parameters: [
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "area", in: "query", schema: { type: "string" } },
          { name: "timing", in: "query", schema: { type: "string" } },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Cursor-paginated drops" } },
      },
      post: {
        tags: ["Drops"],
        summary: "Create drop (API-030)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/DropCreateBody" } },
          },
        },
        responses: {
          201: { description: "Drop created" },
          403: { description: "Unverified or not onboarded" },
        },
      },
    },
    "/drops/{id}": {
      get: {
        tags: ["Drops"],
        summary: "Drop detail (API-013)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "Other-user lat/lng rounded to ~3 decimals" },
          404: { description: "Not found" },
        },
      },
      patch: {
        tags: ["Drops"],
        summary: "Update drop (API-031)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Updated" }, 403: { description: "Not owner or completed" } },
      },
      delete: {
        tags: ["Drops"],
        summary: "Soft-delete drop (API-035)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Deleted" } },
      },
    },
    "/drops/{id}/pause": {
      post: {
        tags: ["Drops"],
        summary: "Pause drop (API-032)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Paused" } },
      },
    },
    "/drops/{id}/resume": {
      post: {
        tags: ["Drops"],
        summary: "Resume drop (API-033)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Active" } },
      },
    },
    "/drops/{id}/fulfill": {
      post: {
        tags: ["Drops"],
        summary: "Fulfill drop (API-034)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "completed; pending tap-ins auto-declined" } },
      },
    },
    "/drops/{id}/tap-ins": {
      post: {
        tags: ["Tap-ins"],
        summary: "Create tap-in (API-040)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/TapInCreateBody" } },
          },
        },
        responses: {
          201: { description: "Tap-in pending" },
          403: { description: "Own drop / not onboarded / drop not active" },
          409: { description: "Duplicate pending tap-in" },
        },
      },
    },
    "/tap-ins/{id}/jobs/complete": {
      post: {
        tags: ["Tap-ins"],
        summary: "Request confirmation that your TapIn job is complete",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { completionImgUrl: { type: "string" } } },
            },
          },
        },
        responses: { 200: { description: "Completion requested" } },
      },
    },
    "/tap-ins/{id}/jobs/complete/confirm": {
      post: {
        tags: ["Tap-ins"],
        summary: "Confirm the other participant's completed TapIn job",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Job completed; reviews unlock after both jobs complete" } },
      },
    },
    "/tap-ins/{id}/review": {
      post: {
        tags: ["Tap-ins"],
        summary: "Review the other participant after both TapIn jobs are complete",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ReviewBody" } } },
        },
        responses: { 201: { description: "Review created" }, 403: { description: "Both jobs are not complete" } },
      },
    },
    "/me/drops": {
      get: {
        tags: ["Drops"],
        summary: "My drops (API-036)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Owner drops including paused" } },
      },
    },
    "/me": {
      get: {
        tags: ["Profile"],
        summary: "Self profile (API-020)",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Full self profile" } },
      },
      patch: {
        tags: ["Profile"],
        summary: "Update profile, avatar, or onboarding (API-021)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  bio: { type: "string" },
                  avatarUrl: { type: "string" },
                  imageUrl: { type: "string", description: "Alias for avatarUrl" },
                  onboarding: {
                    oneOf: [
                      { type: "boolean", enum: [true] },
                      {
                        type: "object",
                        description: "Onboarding fields; may include crafts, skipped, or drop details",
                        properties: {
                          crafts: { type: "array", items: { type: "string" } },
                          skipped: { type: "boolean" },
                          needText: { type: "string" },
                          offerText: { type: "string" },
                          needCategoryId: { type: "string" },
                          offerCategoryId: { type: "string" },
                          areaLabel: { type: "string" },
                          lat: { type: "number" },
                          lng: { type: "number" },
                          date: { type: "string", format: "date-time" },
                          timingChip: { type: "string" },
                          availableDates: { type: "array", items: { type: "string" } },
                          detail: { type: "string" },
                          usageRights: { type: "string" },
                          media: { type: "array", items: { type: "string" } },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Updated" }, 409: { description: "Duplicate handle" } },
      },
      delete: {
        tags: ["Profile"],
        summary: "Soft-delete account (API-028)",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Deleted" } },
      },
    },
    "/me/portfolio": {
      post: {
        tags: ["Profile"],
        summary: "Add portfolio item (API-024)",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Item added (max 12)" } },
      },
    },
    "/me/portfolio/{id}": {
      delete: {
        tags: ["Profile"],
        summary: "Remove portfolio item (API-025)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Removed" } },
      },
    },
    "/me/privacy": {
      patch: {
        tags: ["Profile"],
        summary: "Privacy flags (API-026)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/PrivacyPatch" } },
          },
        },
        responses: { 200: { description: "Updated" } },
      },
    },
    "/me/verification": {
      post: {
        tags: ["Profile"],
        summary: "Request verification badge (API-027)",
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Request stored as pending" } },
      },
    },
    "/me/tap-ins": {
      get: {
        tags: ["Tap-ins"],
        summary: "My tap-ins (API-041)",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "direction",
            in: "query",
            schema: { type: "string", enum: ["incoming", "outgoing"], default: "outgoing" },
          },
          { name: "cursor", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Cursor-paginated tap-ins" } },
      },
    },
    "/tap-ins/{id}/accept": {
      post: {
        tags: ["Tap-ins"],
        summary: "Accept tap-in — creates trade (API-042)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Accepted + trade stub" } },
      },
    },
    "/tap-ins/{id}/decline": {
      post: {
        tags: ["Tap-ins"],
        summary: "Decline tap-in (API-043)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Declined" } },
      },
    },
    "/tap-ins/{id}/withdraw": {
      post: {
        tags: ["Tap-ins"],
        summary: "Withdraw pending tap-in (API-044)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Withdrawn" } },
      },
    },
    "/trades/{id}/complete": {
      post: {
        tags: ["Trades"],
        summary: "Propose trade complete (API-054)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "completion_proposed" } },
      },
    },
    "/trades/{id}/complete/confirm": {
      post: {
        tags: ["Trades"],
        summary: "Confirm completion (API-055)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "completed" } },
      },
    },
    "/trades/{id}/complete/reject": {
      post: {
        tags: ["Trades"],
        summary: "Reject completion proposal (API-056)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Back to in_progress" } },
      },
    },
    "/trades/{id}/review": {
      post: {
        tags: ["Trades"],
        summary: "Review completed trade (API-057)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ReviewBody" } },
          },
        },
        responses: {
          201: { description: "Review created" },
          403: { description: "Trade not completed" },
          409: { description: "Duplicate review" },
        },
      },
    },
    "/radar": {
      get: {
        tags: ["Radar"],
        summary: "Radar pins (API-014)",
        parameters: [
          { name: "lat", in: "query", schema: { type: "number" } },
          { name: "lng", in: "query", schema: { type: "number" } },
          { name: "radius", in: "query", schema: { type: "number", description: "km, default 8" } },
          {
            name: "category",
            in: "query",
            schema: {
              type: "string",
              enum: ["all", "photo", "makeup", "hair", "video"],
            },
          },
          { name: "area", in: "query", schema: { type: "string" } },
        ],
        responses: {
          200: { description: "Pins; lat/lng ~3 decimals; no email" },
        },
      },
    },
    "/users/{handle}": {
      get: {
        tags: ["Public"],
        summary: "Public profile (API-015)",
        parameters: [{ name: "handle", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: { description: "No email/phone; coords rounded" },
          404: { description: "Unknown or soft-deleted" },
        },
      },
    },
  },
};
