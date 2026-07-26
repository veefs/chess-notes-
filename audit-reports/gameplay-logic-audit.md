# Gameplay logic audit

Base revision: `006c3249b387e72e5033ea9a20630dc7637934b2`

## Confirmed findings

1. `play.js` does not parse because `params`, `challengeId`, and `colorParam` are each declared twice in the same scope.
2. `live.js` and `grid.js` allow overlapping polls to apply stale PGN data to a newer game.
3. Puzzle input is unlocked during opponent autoplay and after completion, allowing parity corruption and a terminal `undefined.slice()` failure.
4. Both clients independently decrement and overwrite multiplayer clocks; timeout is not represented as one authoritative game transition.
5. Tournament identity is removed from the URL and not restored from persisted game data after a reload.
6. Puzzle fetch rejection leaves `loading` and `poolLoading` stuck.
7. Puzzle underpromotions are compared only by source/destination and are always played as queen promotions.
8. Non-checkmate board endings are all labeled as draws by agreement.
9. Matchmaking transaction callbacks retain stale opponent values across retries.
10. The puzzle streak script and HTML use different element IDs.
11. Malformed saved settings throw before defaults are exposed.

## Evidence

- `node --check play.js` exited 1 at the duplicate declaration.
- Exact-file VM probes reproduced stale live-game merging, puzzle opponent-drag acceptance, the terminal puzzle exception, and loader flags remaining set after rejection.
- `node --check` passed for the other declared JavaScript files.
- `git diff --exit-code` passed before this report was created.

No external Firebase state was changed or exercised.
