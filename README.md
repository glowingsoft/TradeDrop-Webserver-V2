# TradeDrop-Webserver-V2

## Circle poll votes

Poll votes are stored in the `CirclePollVote` collection. The database must support
transactions for voting, and the unique index on `circleId`, `pollId`, and `userId`
must be created before accepting votes, including when automatic index creation is disabled.