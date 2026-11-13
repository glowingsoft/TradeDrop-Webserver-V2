# TradeDrop-Webserver-V2

## Firebase push notifications

Configure `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and
`FIREBASE_PRIVATE_KEY` in the environment file for the selected `NODE_ENV`
(for example, `.env.dev`). Escaped `\n` sequences in the private key are
converted to newlines. `FIREBASE_DATABASE_URL` is optional. If none of the
three service-account variables are set, the existing
`backend/secretAssets/serviceAccountKey.json` configuration is still supported.
Never commit service-account credentials.

Notification delivery runs in the background. Push-enabled recipients have their
notifications saved and sent to their registered device tokens; delivery errors
are logged. `saveNotification: false` sends without saving an inbox entry.

## Circle poll votes

Poll votes are stored in the `CirclePollVote` collection. The database must support
transactions for voting, and the unique index on `circleId`, `pollId`, and `userId`
must be created before accepting votes, including when automatic index creation is disabled.