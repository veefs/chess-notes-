import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const rulesText = readFileSync("database.rules.json", "utf8");
const rules = JSON.parse(rulesText).rules;
const firebase = JSON.parse(readFileSync("firebase.json", "utf8"));
const play = readFileSync("play.js", "utf8");
const arena = readFileSync("arena.html", "utf8");
const challenges = readFileSync("challenges.js", "utf8");
const profile = readFileSync("profile.html", "utf8");

function collectExpressions(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectExpressions(item, output);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectExpressions(item, output);
  }
  return output;
}

function collectRuleExpressions(value, output = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [key, item] of Object.entries(value)) {
    if (
      (key === ".read" || key === ".write" || key === ".validate")
      && typeof item === "string"
    ) {
      output.push(item);
    } else {
      collectRuleExpressions(item, output);
    }
  }
  return output;
}

assert.equal(firebase.database?.rules, "database.rules.json");
assert.equal(rules[".read"], false);
assert.equal(rules[".write"], false);
assert.deepEqual(
  Object.keys(rules)
    .filter((key) => !key.startsWith("."))
    .sort(),
  ["challenges", "games", "queue", "tournaments", "usernames", "users"],
);

assert.equal(rules.usernames.$username[".read"], true);
assert.match(rules.usernames.$username[".write"], /auth\.uid/);
assert.match(rules.usernames.$username[".write"], /\^\[a-z0-9_-\]\{3,24\}\$/);
assert.match(rules.users.$uid.username[".validate"], /\^\[A-Za-z0-9_-\]\{3,24\}\$/);
assert.match(rules.users.$uid.currentGame[".write"], /status.*playing/);
assert.match(rules.users.$uid.friends.$friendUid[".write"], /friendRequests/);
assert.match(
  rules.challenges.$toUid.$fromUid.state[".write"],
  /!data\.parent\(\)\.hasChild\('state'\)/,
);
assert.match(
  rules.challenges.$toUid.$fromUid.state[".write"],
  /!data\.parent\(\)\.hasChild\('acceptedGameId'\)/,
);
assert.match(
  rules.challenges.$toUid.$fromUid[".write"],
  /!root\.child\('games'\).*exists\(\)/,
);

const regularQueue = rules.queue.$timeControl;
assert.equal(regularQueue[".write"], undefined);
assert.match(regularQueue.$uid[".write"], /claiming/);
assert.match(regularQueue.$uid[".write"], /claimed/);
assert.match(regularQueue.$uid[".write"], /gameId/);
assert.equal(regularQueue.$uid.$other[".validate"], false);

const tournamentQueue = rules.tournaments.$tournamentId.queue;
assert.equal(tournamentQueue[".write"], undefined);
assert.match(tournamentQueue.$uid[".write"], /claiming/);
assert.match(tournamentQueue.$uid[".write"], /players/);
assert.match(tournamentQueue.$uid[".write"], /now < .*endAt/);

assert.deepEqual(rules.games[".indexOn"], ["white/uid", "black/uid"]);
assert.equal(rules.games[".read"], true);
assert.equal(rules.games.$gameId[".read"], true);
assert.doesNotMatch(rules.games.$gameId[".write"], /schemaVersion/);
assert.match(rules.games.$gameId[".validate"], /schemaVersion/);
assert.match(rules.games.$gameId[".validate"], /challenges/);
assert.match(rules.games.$gameId[".validate"], /queue/);
assert.match(rules.games.$gameId[".validate"], /acceptedAt.*now - 300000/);
assert.match(rules.games.$gameId[".validate"], /stateAt.*now - 300000/);
assert.match(rules.games.$gameId.createdBy[".validate"], /acceptedAt.*now \+ 300000/);
assert.match(rules.games.$gameId.createdBy[".validate"], /stateAt.*now \+ 300000/);
assert.match(rules.games.$gameId[".validate"], /now < .*endAt/);
assert.match(
  rules.games.$gameId[".validate"],
  /!data\.child\('moves'\)\.hasChildren\(\)/,
);
assert.match(
  rules.games.$gameId[".validate"],
  /position\/ply.*- 1.*moves.*position\/ply.*exists/,
);
assert.match(
  rules.games.$gameId.schemaVersion[".write"],
  /currentGame.*\$gameId/,
);
assert.equal(rules.games.$gameId.moves[".write"], undefined);
assert.match(rules.games.$gameId.moves.$moveIndex[".write"], /position\/ply/);
assert.match(rules.games.$gameId.position[".write"], /moves/);
assert.match(rules.games.$gameId.clocks.white[".write"], /turnUid/);
assert.match(rules.games.$gameId.clocks.black[".write"], /turnUid/);
assert.match(rules.games.$gameId.clocks[".validate"], /position\/ply.*== 0/);
assert.match(rules.games.$gameId.clocks[".validate"], /whiteTime.*blackTime/);
assert.doesNotMatch(
  rules.games.$gameId.white.username[".validate"],
  /\^\[A-Za-z0-9_-\]/,
);
assert.doesNotMatch(
  rules.games.$gameId.black.username[".validate"],
  /\^\[A-Za-z0-9_-\]/,
);
assert.equal(rules.games.$gameId.$other[".validate"], false);
assert.doesNotMatch(rulesText, /1785110400000/);

assert.match(rules.tournaments.$tournamentId[".validate"], /status.*waiting/);
assert.match(rules.tournaments.$tournamentId.status[".write"], /startAt/);
assert.match(rules.tournaments.$tournamentId.players.$uid[".validate"], /gamesPlayed/);
assert.doesNotMatch(
  rules.tournaments.$tournamentId.creatorUsername[".validate"],
  /\^\[A-Za-z0-9_-\]/,
);
assert.equal(rules.tournaments.$tournamentId.$other[".validate"], false);

assert.doesNotMatch(rulesText, /numChildren\s*\(/);
for (const expression of collectRuleExpressions(rules)) {
  assert.doesNotThrow(
    () => Function(`"use strict"; return (${expression});`),
    `invalid Rules expression syntax: ${expression}`,
  );
}
const allowedCalls = new Set([
  "beginsWith",
  "child",
  "exists",
  "hasChild",
  "hasChildren",
  "isBoolean",
  "isNumber",
  "isString",
  "matches",
  "parent",
  "toLowerCase",
  "val",
]);
for (const expression of collectExpressions(rules)) {
  for (const match of expression.matchAll(/\.([A-Za-z][A-Za-z0-9]*)\s*\(/g)) {
    assert.ok(
      allowedCalls.has(match[1]),
      `unsupported or unreviewed Rules call: ${match[1]}`,
    );
  }
}

assert.match(play, /state:\s*"claiming"/);
assert.match(play, /state:\s*"claimed"/);
assert.match(play, /\[`moves\/\$\{oldPly\}`\]/);
assert.match(play, /position:\s*\{/);
assert.match(play, /ensureGameSchema/);
assert.match(play, /move history is not contiguous/);
assert.match(play, /kind === "challenge" && ply === 0/);
assert.match(play, /hasCanonicalChallengeMarker \|\| !hasLegacyTimeControl/);
assert.match(play, /isFreshQueueTimestamp\(candidate\.joinedAt, queueWindowNow\)/);
const ensureSchemaStart = play.indexOf("async function ensureGameSchema");
const ensureSchemaEnd = play.indexOf("\nfunction syncBoardFromData", ensureSchemaStart);
assert.ok(ensureSchemaStart >= 0 && ensureSchemaEnd > ensureSchemaStart);
const ensureSchemaSource = play.slice(ensureSchemaStart, ensureSchemaEnd);
assert.doesNotMatch(
  ensureSchemaSource,
  /get\(ref\(db,\s*`users\/\$\{whiteUid\}\/currentGame`\)\)/,
);
assert.doesNotMatch(
  ensureSchemaSource,
  /get\(ref\(db,\s*`users\/\$\{blackUid\}\/currentGame`\)\)/,
);
assert.ok(
  play.indexOf("await disconnect.remove()") < play.indexOf("await set(myQueueRef, entry)"),
  "onDisconnect cleanup must be registered before the queue entry is published",
);
assert.doesNotMatch(play, /runTransaction\s*\(\s*queueRef/);
assert.doesNotMatch(play, /games\/\$\{currentGameId\}\/moves/);

assert.match(arena, /state:\s*"claiming"/);
assert.match(arena, /state:\s*"claimed"/);
assert.match(arena, /kind:\s*"tournament"/);
assert.match(arena, /isFreshQueueTimestamp\(entry\.joinedAt, queueWindowNow\)/);
assert.doesNotMatch(
  arena,
  /runTransaction\s*\(\s*ref\(db,\s*`tournaments\/\$\{id\}\/queue`\)/,
);

assert.match(challenges, /state:\s*"accepted"/);
assert.match(challenges, /kind:\s*"challenge"/);
assert.match(challenges, /data\.acceptedGameId !== undefined/);
assert.match(profile, /users\/\$\{uid\}\/friends\/\$\{fromUid\}/);
assert.match(profile, /users\/\$\{fromUid\}\/friends\/\$\{uid\}/);
assert.match(profile, /isExistingUsernameKey/);

assert.equal(existsSync(".firebaserc"), false);
assert.equal(existsSync("SECURITY.md"), false);

for (const script of ["auth.js", "challenges.js", "play.js"]) {
  const syntax = spawnSync(process.execPath, ["--check", script], {
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout);
}

console.log("firebase rules and client contract static checks passed");
