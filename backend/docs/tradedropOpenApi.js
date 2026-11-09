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
      "**Pagination:** page/limit with `meta` on paginated list endpoints.\n\n" +
      "Circle discussions use the Circle group chat; Event RSVPs and poll votes are embedded in their parent records.",
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
    { name: "Connections", description: "Connection request lifecycle and network" },
    { name: "Circles", description: "Circle membership, discussions, and polls" },
    { name: "Events", description: "Circle events and embedded RSVPs" },
    { name: "Messaging", description: "Participant-authorized personal, Circle, and project chats" },
    { name: "Activity", description: "Received, sent, and work activity" },
    { name: "Reports", description: "User reports and staff moderation" },
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
        required: [],
        properties: {
          status: { type: "string", enum: ["draft", "open", "publish"], default: "draft" },
          type: { type: "string", enum: ["in_person", "remote"], default: "in_person" },
          title: { type: "string", maxLength: 120 },
          locationType: { type: "string", enum: ["neighborhood", "specific", "remote"] },
          referenceImages: { type: "array", items: { type: "string" }, maxItems: 10 },
          startTime: { type: "string", example: "18:30", nullable: true, description: "HH:mm, with timingType=specific" },
          endTime: { type: "string", example: "20:00", nullable: true, description: "HH:mm, with timingType=specific" },
          timingType: { type: "string", enum: ["specific", "range", "flexible"] },
          date: { type: "string", format: "date-time", nullable: true },
          dateFrom: { type: "string", format: "date-time", nullable: true },
          dateTo: { type: "string", format: "date-time", nullable: true },
          tapInDeadline: { type: "string", format: "date-time", nullable: true, description: "Optional, all timing types" },
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
          idea: { type: "string" },
          usageRights: { type: "string" },
          media: { type: "array", items: { type: "string" } },
        },
      },
      TapInCreateBody: {
        type: "object",
        properties: {
          notes: { type: "string", maxLength: 1000 },
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
          { name: "needCategoryId", in: "query", schema: { type: "string" } },
          { name: "areaLabel", in: "query", schema: { type: "string" } },
          { name: "timingChip", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Paginated published Drops" } },
      },
      post: {
        tags: ["Drops"],
        summary: "Create a Drop draft (all new Drops start as drafts)",
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
        description:
          "mutualCollaborationCount counts active and completed collaborations between the viewer and the Drop owner. " +
          "It is zero for anonymous viewers and the owner.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          200: {
            description: "Drop detail; other-user lat/lng rounded to ~3 decimals",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: { mutualCollaborationCount: { type: "integer", minimum: 0 } },
                    },
                  },
                },
              },
            },
          },
          404: { description: "Not found" },
        },
      },
      patch: {
        tags: ["Drops"],
        summary: "Update drop (API-031)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Updated draft or open Drop" }, 403: { description: "Not owner" } },
      },
      delete: {
        tags: ["Drops"],
        summary: "Soft-delete drop (API-035)",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Deleted" } },
      },
    },
    "/drops/{id}/publish": {
      post: {
        tags: ["Drops"],
        summary: "Publish a draft, returning current open Drop IDs if the two-Drop limit is reached",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Published or kept as a draft when at capacity" } },
      },
    },
    "/drops/{id}/close": {
      post: {
        tags: ["Drops"],
        summary: "Close a Drop and its pending Tap Ins",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Closed; accepted Collaborations remain active" } },
      },
    },
    "/drops/{id}/reopen": {
      post: {
        tags: ["Drops"],
        summary: "Reopen a closed or expired Drop for seven days",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Reopened or not reopened when at capacity" } },
      },
    },
    "/drops/{id}/extend": {
      post: {
        tags: ["Drops"],
        summary: "Extend an open Drop for seven days",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Extended or reopened" } },
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
        summary: "My open Drops by default; use status=ended for closed or expired Drops",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["open", "draft", "closed", "expired", "ended"], default: "open" },
          },
        ],
        responses: { 200: { description: "Paginated Drops owned by the caller, including draft and ended filters" } },
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
                  profileIcon: { type: "string" },
                  imageUrl: { type: "string", description: "Alias for profileIcon" },
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
                          idea: { type: "string" },
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
        description: "An item requires one to six imageUrls. Maximum 12 items.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  imageUrls: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
                  title: { type: "string" },
                  sortOrder: { type: "number" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Item added" }, 400: { description: "Invalid images or portfolio limit reached" } },
      },
    },
    "/me/portfolio/{id}": {
      patch: {
        tags: ["Profile"],
        summary: "Edit a portfolio item",
        description: "imageUrls replaces the complete image list; use it to add, remove, reorder or replace images. One to six images are required.",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  imageUrls: { type: "array", minItems: 1, maxItems: 6, items: { type: "string" } },
                  title: { type: "string" },
                  sortOrder: { type: "number" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "Updated profile" }, 400: { description: "Invalid update" }, 404: { description: "Item not found" } },
      },
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
    "/trades/{id}/done": {
      post: {
        tags: ["Trades"],
        summary: "Confirm your side of Collaboration completion",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Completion requires confirmation from both participants" } },
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
    "/radar/people": {
      get: {
        tags: ["Radar"],
        summary: "Radar people with people-only filters",
        parameters: [
          { name: "lat", in: "query", schema: { type: "number" } },
          { name: "lng", in: "query", schema: { type: "number" } },
          { name: "radius", in: "query", schema: { type: "number" } },
          { name: "categories", in: "query", schema: { type: "array", items: { type: "string" } } },
          { name: "openToWork", in: "query", schema: { type: "boolean" } },
          { name: "connectionsOnly", in: "query", schema: { type: "boolean" } },
          { name: "hasAnOpenDrop", in: "query", schema: { type: "boolean" } },
        ],
        responses: { 200: { description: "Radar people" } },
      },
    },
    "/radar/people/{id}": {
      get: {
        tags: ["Radar"],
        summary: "Radar person details, connection state and public open Drops",
        description:
          "Returns a visible radar profile with connectionCount, connectionStatus, requestSent and requestId. " +
          "connectionId contains the active connection ID, or the outgoing request ID when a request is pending. " +
          "latestConnections contains up to two active connection profiles visible to the viewer, ordered by most recently updated. " +
          "mutualCollaborationCount counts active and completed collaborations between the viewer and the person. " +
          "latestCollaborations contains at most two completed collaboration summaries; latestCircles contains " +
          "at most two non-deleted circles created by the person, including invite-only circles. " +
          "openDrops is a paginated array of public, open, unexpired Drops. " +
          "Blocked, deleted, inactive or radar-hidden users are not returned.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 10 } },
        ],
        responses: {
          200: {
            description: "Radar person details and paginated open Drops",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { type: "string" },
                    data: {
                      type: "object",
                      properties: {
                        _id: { type: "string" },
                        name: { type: "string" },
                        handle: { type: "string" },
                        profileIcon: { type: "string" },
                        hasConnection: { type: "boolean" },
                        connectionId: { type: "string", nullable: true },
                        requestId: { type: "string", nullable: true },
                        connectionCount: { type: "integer", minimum: 0 },
                        mutualCollaborationCount: { type: "integer", minimum: 0 },
                        latestConnections: {
                          type: "array",
                          maxItems: 2,
                          items: {
                            type: "object",
                            properties: {
                              _id: { type: "string" },
                              name: { type: "string" },
                              handle: { type: "string" },
                              profileIcon: { type: "string" },
                            },
                          },
                        },
                        requestSent: { type: "boolean" },
                        connectionStatus: {
                          type: "string",
                          enum: ["connected", "incoming_request", "request_sent", "declined", "not_connected"],
                        },
                        canSendConnectionRequest: { type: "boolean" },
                        openDrops: { type: "array", items: { type: "object" } },
                        latestCollaborations: { type: "array", maxItems: 2, items: { type: "object" } },
                        latestCircles: { type: "array", maxItems: 2, items: { type: "object" } },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: "Authentication required" },
          404: { description: "Person not found or not visible" },
        },
      },
    },
    "/radar/drops": {
      get: {
        tags: ["Radar"],
        summary: "Radar Drops with Drop-only filters",
        parameters: [
          { name: "lat", in: "query", schema: { type: "number" } },
          { name: "lng", in: "query", schema: { type: "number" } },
          { name: "radius", in: "query", schema: { type: "number" } },
          { name: "categories", in: "query", schema: { type: "array", items: { type: "string" } } },
          { name: "type", in: "query", schema: { type: "string", enum: ["any", "in_person", "remote"] } },
          {
            name: "date",
            in: "query",
            schema: { type: "string", enum: ["anytime", "next7days", "next7dys", "next30days"] },
          },
          { name: "tag", in: "query", schema: { type: "string", enum: ["isNew"] } },
        ],
        responses: { 200: { description: "Radar Drops" } },
      },
    },
    "/radar": {
      get: {
        tags: ["Radar"],
        summary: "Radar: Nearby People and Open Drops",
        parameters: [
          { name: "lat", in: "query", schema: { type: "number" } },
          { name: "lng", in: "query", schema: { type: "number" } },
          { name: "radius", in: "query", schema: { type: "number", description: "km, default 8" } },
          {
            name: "categories",
            in: "query",
            style: "form",
            explode: true,
            schema: { type: "array", items: { type: "string" } },
          },
          {
            name: "category",
            in: "query",
            schema: {
              type: "string",
              enum: ["all", "photo", "makeup", "hair", "video"],
            },
          },
          { name: "area", in: "query", schema: { type: "string" } },
          { name: "openToWork", in: "query", schema: { type: "boolean" } },
          { name: "connectionsOnly", in: "query", schema: { type: "boolean" } },
          { name: "hasAnOpenDrop", in: "query", schema: { type: "boolean" } },
          { name: "type", in: "query", schema: { type: "string", enum: ["any", "in_person", "remote"] } },
          {
            name: "date",
            in: "query",
            schema: { type: "string", enum: ["anytime", "next7days", "next7dys", "next30days"] },
          },
        ],
        responses: {
          200: { description: "Nearby People with connection state and open Drop IDs, plus Open Drops; no email" },
        },
      },
    },
    "/for-you": {
      get: {
        tags: ["Radar"],
        summary: "Nearby Circles, Events, and Drops; set anywhere=true to remove the location restriction",
        parameters: [
          { name: "lat", in: "query", schema: { type: "number" } },
          { name: "lng", in: "query", schema: { type: "number" } },
          { name: "anywhere", in: "query", schema: { type: "boolean" } },
        ],
        responses: { 200: { description: "Paginated discovery results" } },
      },
    },
    "/activity/{tab}": {
      get: {
        tags: ["Activity"],
        summary: "Activity tabs: received, sent, or work",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "tab", in: "path", required: true, schema: { type: "string", enum: ["received", "sent", "work"] } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Activity payload and pagination metadata" } },
      },
    },
    "/connection-requests": {
      post: {
        tags: ["Connections"],
        summary: "Send a connection request, optionally with a note",
        security: [{ bearerAuth: [] }],
        responses: {
          201: { description: "Request sent" },
          409: { description: "Pending request or decline cooldown" },
        },
      },
    },
    "/connection-requests/incoming": {
      get: {
        tags: ["Connections"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Incoming requests" } },
      },
    },
    "/connection-requests/outgoing": {
      get: {
        tags: ["Connections"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Outgoing requests and statuses" } },
      },
    },
    "/connection-requests/{id}/accept": {
      post: {
        tags: ["Connections"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Request accepted" } },
      },
    },
    "/connection-requests/{id}/decline": {
      post: {
        tags: ["Connections"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Request declined with a 30-day pair cooldown" } },
      },
    },
    "/connection-requests/{id}/withdraw": {
      post: {
        tags: ["Connections"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Request withdrawn" } },
      },
    },
    "/connections/{userId}": {
      delete: {
        tags: ["Connections"],
        summary: "Remove an active connection without restoring it on unblock",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "userId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Connection removed; personal messaging is closed" } },
      },
    },
    "/me/network": {
      get: {
        tags: ["Connections"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Latest five connections, pending requests, Circles, open Drops, and saved people" } },
      },
    },
    "/me/collaborations": {
      get: {
        tags: ["Trades"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Paginated Collaborations and participant details" } },
      },
    },
    "/trades/{id}/disputes": {
      post: {
        tags: ["Trades"],
        summary: "Open a Collaboration dispute",
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          201: { description: "Dispute opened (20-500 character description; up to three evidence images)" },
        },
      },
    },
    "/disputes/{id}/respond": {
      post: {
        tags: ["Trades"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Respond to the dispute" } },
      },
    },
    "/disputes/{id}/mutual-resolved": {
      post: {
        tags: ["Trades"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "One participant confirms resolution; both must confirm" } },
      },
    },
    "/disputes/{id}/request-review": {
      post: {
        tags: ["Trades"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Request TradeDrop review" } },
      },
    },
    "/disputes/{id}/withdraw": {
      post: {
        tags: ["Trades"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Opener withdraws the dispute" } },
      },
    },
    "/disputes/{id}/resolve": {
      post: {
        tags: ["Trades"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Authorized administrator resolves reviewed dispute" } },
      },
    },
    "/circles": {
      get: {
        tags: ["Circles"],
        summary: "Discover nearby Open and Approval Circles",
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "category", schema: { type: "string" } },
          { in: "query", name: "city", schema: { type: "string" } },
          { in: "query", name: "keyword", schema: { type: "string" } },
          { in: "query", name: "lat", schema: { type: "number" } },
          { in: "query", name: "lng", schema: { type: "number" } },
          { in: "query", name: "radius", schema: { type: "number", exclusiveMinimum: 0 } },
        ],
        responses: { 200: { description: "Paginated Circle discovery results with optional location filtering" } },
      },
    },
    "/circles/all": {
      get: {
        tags: ["Circles"],
        summary: "Get all Circles without location filtering",
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "category", schema: { type: "string" } },
          {
            in: "query",
            name: "privacy",
            schema: { type: "string", enum: ["open", "invite-only", "approval-required"] },
          },
          { in: "query", name: "city", schema: { type: "string" } },
          { in: "query", name: "status", schema: { type: "string", enum: ["active", "reported"] } },
          { in: "query", name: "keyword", schema: { type: "string" } },
        ],
        responses: {
          200: {
            description:
              "Filtered Circle results with aggregate circle, member, report, and active-pool counts in meta.count; invite-only Circles are visible only to their active members",
          },
        },
      },
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: "Create Circle and its group chat" } },
      },
    },
    "/me/circles": {
      get: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Paginated searchable Circle memberships" } },
      },
    },
    "/circles/{id}": {
      get: {
        tags: ["Circles"],
        responses: { 200: { description: "Circle details, member roles, latest Event, and open member Drops" } },
      },
      patch: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Update Circle (organizer only)" } },
      },
      delete: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Delete Circle and consistently close linked records" } },
      },
    },
    "/circles/{id}/join": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Join Open or request Approval membership" } },
      },
    },
    "/circles/{id}/leave": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Leave Circle" } },
      },
    },
    "/circles/{id}/members/{userId}/approve": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "Organizer approves a membership request" } },
      },
    },
    "/circles/{id}/members/{userId}/decline": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "Organizer declines a membership request" } },
      },
    },
    "/circles/{id}/invitations": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Invite the organizer's active connections to a Circle of any privacy" } },
      },
    },
    "/circles/{id}/invitations/respond": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Accept or decline a Circle invitation" } },
      },
    },
    "/circles/{id}/transfer-organizer": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Transfer organizer responsibility to another active member" } },
      },
    },
    "/circles/{id}/members": {
      get: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "pending", "invited"] } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Paginated Circle members; pending and invited lists are organizer-only" } },
      },
    },
    "/circles/{id}/polls": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: "Create a Circle poll; up to three can be active, with a default two-day duration" } },
      },
    },
    "/circles/{id}/polls/{pollId}/vote": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "pollId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "Vote once in the specified active Circle poll" } },
      },
    },
    "/circles/{id}/polls/vote": {
      post: {
        tags: ["Circles"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Legacy vote route; include pollId when multiple Circle polls are active" } },
      },
    },
    "/events": {
      get: {
        tags: ["Events"],
        responses: { 200: { description: "Published Events visible under Circle audience rules" } },
      },
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: "Create an Event draft in a Circle the caller organizes" } },
      },
    },
    "/events/all": {
      get: {
        tags: ["Events"],
        summary: "Get all Events without location filtering",
        parameters: [
          { in: "query", name: "page", schema: { type: "integer", minimum: 1 } },
          { in: "query", name: "limit", schema: { type: "integer", minimum: 1, maximum: 100 } },
          { in: "query", name: "keyword", description: "Matches Event name or organizer name", schema: { type: "string" } },
          { in: "query", name: "circleId", schema: { type: "string" } },
          { in: "query", name: "audience", schema: { type: "string", enum: ["public", "member_only"] } },
          { in: "query", name: "status", schema: { type: "string", enum: ["upcoming", "cancelled"] } },
        ],
        responses: {
          200: {
            description:
              "Paginated Events; meta.count holds total, upcoming, ongoing (total going RSVPs), cancelled, and reports across all matching Events ignoring the status filter",
          },
        },
      },
    },
    "/events/{id}": {
      get: {
        tags: ["Events"],
        responses: { 200: { description: "Event details and relevant open Circle-member Drops" } },
      },
      patch: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Edit Event draft" } },
      },
    },
    "/events/{id}/publish": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Publish organizer-approved Event draft" } },
      },
    },
    "/events/{id}/cancel": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Cancel Event" } },
      },
    },
    "/events/{id}/rsvp": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "RSVP or reserve a capacity waitlist position" } },
      },
    },
    "/events/{id}/rsvp/cancel": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Cancel the caller's Event reservation" } },
      },
    },
    "/events/{id}/rsvp/{userId}/approve": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "Organizer approves an Event reservation request" } },
      },
    },
    "/events/{id}/rsvp/{userId}/decline": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { 200: { description: "Organizer declines an Event reservation request" } },
      },
    },
    "/circles/{circleId}/event-suggestions": {
      get: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "circleId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Organizer-visible Event suggestions" } },
      },
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "circleId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 201: { description: "Submit an Event suggestion for organizer approval" } },
      },
    },
    "/events/{id}/suggestion/approve": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Organizer approves an Event suggestion as a draft" } },
      },
    },
    "/events/{id}/suggestion/decline": {
      post: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Organizer declines an Event suggestion" } },
      },
    },
    "/events/{id}/suggestion": {
      delete: {
        tags: ["Events"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Organizer removes an Event suggestion" } },
      },
    },
    "/conversations": {
      get: {
        tags: ["Messaging"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Caller-visible conversations" } },
      },
    },
    "/conversations/messages": {
      get: {
        tags: ["Messaging"],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "conversationId", in: "query", schema: { type: "string" } },
          { name: "objectId", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: { 200: { description: "Paginated messages; fetching marks received messages read" } },
      },
    },
    "/conversations/message": {
      post: {
        tags: ["Messaging"],
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["conversationType", "messageType"],
                properties: {
                  conversationType: { type: "string", enum: ["direct", "group", "project"] },
                  conversationId: { type: "string" },
                  participantId: { type: "string", description: "Required when creating a direct conversation" },
                  messageType: { type: "string", enum: ["text", "audio", "file"] },
                  messageContent: { type: "string" },
                  mediaUrl: { type: "string" },
                  replyTo: { type: "string", description: "Parent message in the same conversation" },
                },
              },
            },
          },
        },
        responses: {
          201: { description: "Message sent after conversation authorization" },
          403: { description: "Connection, Circle membership, or Collaboration access required" },
        },
      },
    },
    "/conversations/{conversationId}": {
      delete: {
        tags: ["Messaging"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Delete an eligible caller-owned conversation" } },
      },
    },
    "/conversations/{conversationId}/action": {
      put: {
        tags: ["Messaging"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Update the caller's conversation state" } },
      },
    },
    "/conversations/{conversationId}/participants": {
      post: {
        tags: ["Messaging"],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: "conversationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Add participants to an eligible non-Circle group" } },
      },
    },
    "/reports": {
      post: {
        tags: ["Reports"],
        security: [{ bearerAuth: [] }],
        responses: { 201: { description: "Create report with optional block" } },
      },
    },
    "/me/reports": {
      get: {
        tags: ["Reports"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Reporter-owned reports" } },
      },
    },
    "/admin/reports": {
      get: {
        tags: ["Reports"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Staff report moderation queue" } },
      },
    },
    "/admin/reports/{id}": {
      patch: {
        tags: ["Reports"],
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Staff-only status transition; reporter is notified" } },
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
