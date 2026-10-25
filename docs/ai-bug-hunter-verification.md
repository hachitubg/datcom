# AI Bug Hunter verification

Jira: [KAN-1](https://hachitu.atlassian.net/browse/KAN-1), [KAN-2](https://hachitu.atlassian.net/browse/KAN-2).

Baseline application: `684a8163ee3d8b730256129fbc51d31716de977a`.
The new HTTP regression test failed 14 of 21 assertions against that application;
malformed scores also changed the leaderboard. All seven pre-existing test scripts passed.

## Changes

- Require safe JSON integers for score, level and caught; reject missing/invalid fields with HTTP400 before database writes.
- Preserve zero scores/caught, levels1..10 and unauthenticated401 behavior.
- Add `test/game-score-validation.test.js` to `npm test`. It starts the actual Express server with a fresh SQLite fixture and checks leaderboard integrity after rejected requests.
- Patch body-parser1.20.8→1.20.9 and undici6.29.0→6.29.1 in the lockfile, within existing dependency ranges.

## Reproduce

Run in a disposable checkout/container with no production `.env`, database or backups:

```sh
npm ci --omit=dev
npm run check
npm test
npm audit --omit=dev --audit-level=high
```

The test sets its own fake session credentials, disables PayOS, binds an ephemeral port,
and removes its fixture database. `SOURCE_SHA` and `REPORT_PATH` optionally record the
tested commit and JSON assertions. Do not set `ADMIN_INITIAL_PASSWORD` globally when
running the existing suite: some tests expect an unseeded database.

Local verification uses Node22 on Debian trixie; sqlite3's current prebuilt binary
needs a newer glibc than Debian bookworm provides. GitHub CI retains its existing
Ubuntu/Node20 matrix and independently verifies the PR.

This validates input types and bounds; it does not establish that client-submitted
integer scores are honest. This PR does not merge or deploy anything.
