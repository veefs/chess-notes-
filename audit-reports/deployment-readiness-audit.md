# Deployment readiness audit

Base revision: `006c3249b387e72e5033ea9a20630dc7637934b2`

## Confirmed findings

1. `play.js` is a release blocker because it fails to parse.
2. The default puzzle piece URLs return 404, although equivalent local piece assets exist.
3. Puzzle loading has no safe failure path and can remain permanently busy after one network error.
4. Firebase readiness polling has no deadline or user-facing failure state.
5. Puzzle information IDs in HTML and JavaScript do not agree.
6. The Git LFS puzzle object is about 1.08 GB and the runtime URL follows mutable `main`, creating clone and deployment risk.

## Evidence

- `node --check play.js` exited 1.
- All 12 probed default puzzle piece URLs returned HTTP 404.
- A bounded VM probe reproduced stuck puzzle loader flags.
- The current LFS pointer resolved to ranged CSV content with a reported size of 1,084,213,690 bytes.
- `git diff --exit-code` passed before this report was created.

Remote checks are point-in-time observations. No deployment, account, or production data was changed.
