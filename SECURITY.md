# Security

## Reporting

Please report vulnerabilities privately through GitHub's security-advisory
workflow when it is available for this repository. Do not include credentials,
personal data, or production database contents in a public issue.

## Deployment boundary

FaithChess is a browser client. Client-side validation improves reliability and
reduces accidental corruption, but it is not authorization. A production
deployment must enforce Firebase Realtime Database Rules (or trusted server
code) for at least:

- username ownership and profile-field writes;
- matchmaking, challenge sender/recipient identity, and immutable challenge
  claims;
- create-only game identity, participant-only moves, legal state transitions,
  and trusted result/rating updates;
- tournament scores, friend requests, and reciprocal friendship changes; and
- server-authoritative timestamps and clocks.

No Firebase Rules or emulator configuration is currently tracked in this
repository. Treat authenticated multiplayer, ratings, tournaments, challenges,
and friendships as production-unverified until those controls are reviewed and
deployed.

The Cloudinary unsigned upload preset must also be restricted in Cloudinary to
the intended image formats, size, account, and delivery path. The browser
accepts only HTTPS avatar URLs under this project's image-upload path.

## Secrets

Firebase web configuration identifies the public client and is not a substitute
for database authorization. Never commit service-account keys, private API
keys, upload secrets, webhook endpoints, passwords, or `.env` files.

A previously tracked submission credential has been removed from the current
tree. Because Git history is immutable without a coordinated rewrite, its owner
must revoke or rotate that credential independently. This repair does not
rewrite or force-push repository history.
