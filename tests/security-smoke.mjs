import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script, createContext } from "node:vm";

const [auth, challenges, profile, signup, theory] = await Promise.all([
  readFile(new URL("../auth.js", import.meta.url), "utf8"),
  readFile(new URL("../challenges.js", import.meta.url), "utf8"),
  readFile(new URL("../profile.html", import.meta.url), "utf8"),
  readFile(new URL("../signup.html", import.meta.url), "utf8"),
  readFile(new URL("../theory.html", import.meta.url), "utf8"),
]);

assert.doesNotMatch(
  auth,
  /innerHTML\s*=/,
  "auth menu must be assembled with DOM nodes, not HTML strings",
);
assert.match(auth, /safeAvatarUrl/);
assert.match(auth, /hostname === "res\.cloudinary\.com"/);
assert.match(auth, /CLOUDINARY_AVATAR_PATH_PREFIX = "\/dszgbkb1f\/image\/upload\/"/);
assert.match(auth, /!url\.username/);
assert.match(auth, /!url\.password/);
assert.match(auth, /!url\.port/);

for (const [name, source] of [
  ["challenges.js", challenges],
  ["profile.html", profile],
]) {
  assert.match(source, /isSafeFirebaseSegment/);
  assert.doesNotMatch(
    source,
    /innerHTML\s*=\s*`[^`]*\$\{(?:data\.fromUsername|data\.username|g\.opponentUsername|fname|username)/s,
    `${name} must not interpolate user-controlled names into HTML`,
  );
}

assert.match(challenges, /label\.textContent = `⚔ \$\{displayName\(data\.fromUsername\)\}`/);
assert.match(challenges, /acceptedGameId/);
assert.match(challenges, /runTransaction/);
assert.match(challenges, /\{ applyLocally: false \}/);
assert.match(challenges, /await update\(ref\(db\), updates\)/);
assert.match(challenges, /activeColor: "white"/);
assert.match(challenges, /value\.fromUid === fromUid/);
assert.match(challenges, /value\.toUid === toUid/);
assert.match(profile, /appendTextElement\(details, "game-opponent", `vs \$\{opponent\}`\)/);
assert.match(profile, /appendTextElement\(item, "request-label"/);
assert.match(profile, /pieceTheme:\s+window\.resolvePieceTheme/);
assert.match(profile, /await update\(ref\(db\), \{\s*\[`users\/\$\{uid\}\/friends\/\$\{fromUid\}`\]: true,/s);
assert.doesNotMatch(
  signup,
  /\[`users\/\$\{uid\}`\]\s*:\s*\{[\s\S]*?\bemail\s*,/s,
  "Realtime Database profiles must not duplicate Firebase Auth email addresses",
);
assert.doesNotMatch(theory, /discord(?:app)?\.com\/api\/webhooks|WEBHOOK_URL/i);
assert.match(theory, /const BASE='pieces\/cburnett\/';/);
assert.match(
  theory,
  /href="https:\/\/github\.com\/veefs\/chess-notes-\/issues\/new"[^>]*rel="noopener noreferrer"/,
);

function extractFunction(source, name) {
  const match = source.match(
    new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, "m"),
  );
  assert.ok(match, `missing function ${name}`);
  return match[0];
}

function evaluateAvatarPolicy() {
  const prefix = auth.match(
    /^const CLOUDINARY_AVATAR_PATH_PREFIX = .*;$/m,
  );
  assert.ok(prefix, "missing Cloudinary avatar path policy");
  const context = createContext({ URL });
  new Script(
    `${prefix[0]}\n${extractFunction(auth, "safeAvatarUrl")}\n` +
    "globalThis.avatarPolicy = safeAvatarUrl;",
  ).runInContext(context);
  return context.avatarPolicy;
}

function evaluateProfileSegmentPolicy() {
  const normalizedProfile = profile.replace(/\r\n/g, "\n");
  const start = normalizedProfile.indexOf("  const RESERVED_FIREBASE_SEGMENTS");
  const end = normalizedProfile.indexOf("\n\n  function displayName", start);
  assert.ok(start >= 0 && end > start, "missing profile segment policy");
  const policySource = normalizedProfile.slice(start, end).replace(/^  /gm, "");
  const context = createContext({});
  new Script(
    `${policySource}\nglobalThis.segmentPolicy = isSafeFirebaseSegment;`,
  ).runInContext(context);
  return context.segmentPolicy;
}

function stripImports(source) {
  return source.replace(/^import[\s\S]*?;\r?\n/gm, "");
}

const clone = value => value == null
  ? value
  : JSON.parse(JSON.stringify(value));

function createChallengeHarness({
  challenge,
  ids = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003",
  ],
  initialEntries = [],
} = {}) {
  const state = new Map(initialEntries.map(([path, value]) => [path, clone(value)]));
  if (challenge !== undefined) {
    state.set("challenges/recipient/sender", clone(challenge));
  }

  const transactionCalls = [];
  const toasts = [];
  const controls = {
    failChallengeTransactions: 0,
    failGameTransactions: 0,
    failUpdates: 0,
  };
  let now = 1_000;
  let idIndex = 0;

  const snapshot = value => ({
    exists: () => value != null,
    val: () => clone(value),
  });
  const readPath = path => state.has(path) ? clone(state.get(path)) : null;
  const writePath = (path, value) => {
    if (value == null) state.delete(path);
    else state.set(path, clone(value));
  };

  const context = createContext({
    initializeApp: () => ({}),
    getApps: () => [],
    getDatabase: () => ({}),
    getAuth: () => ({}),
    ref: (_db, path = "") => path,
    get: async path => snapshot(readPath(path)),
    onValue: () => () => {},
    onAuthStateChanged: () => () => {},
    update: async (_root, updates) => {
      if (controls.failUpdates > 0) {
        controls.failUpdates -= 1;
        throw new Error("injected finalize failure");
      }
      for (const [path, value] of Object.entries(updates)) {
        writePath(path, value);
      }
    },
    runTransaction: async (path, updater, options) => {
      transactionCalls.push({ path, applyLocally: options?.applyLocally });
      assert.equal(
        options?.applyLocally,
        false,
        `transaction at ${path} must disable local speculative state`,
      );
      if (
        path.startsWith("challenges/")
        && controls.failChallengeTransactions > 0
      ) {
        controls.failChallengeTransactions -= 1;
        throw new Error("injected challenge transaction failure");
      }
      if (path.startsWith("games/") && controls.failGameTransactions > 0) {
        controls.failGameTransactions -= 1;
        throw new Error("injected create failure");
      }

      const current = readPath(path);
      const next = updater(clone(current));
      if (next === undefined) {
        return { committed: false, snapshot: snapshot(current) };
      }
      writePath(path, next);
      return { committed: true, snapshot: snapshot(next) };
    },
    crypto: {
      randomUUID: () => {
        assert.ok(idIndex < ids.length, "test UUID sequence exhausted");
        return ids[idIndex++];
      },
    },
    Date: { now: () => now++ },
    document: {
      createElement: () => ({
        remove() {},
        style: {},
        textContent: "",
      }),
      body: {
        appendChild: element => toasts.push(element.textContent),
      },
      getElementById: () => null,
    },
    window: { location: { href: "" } },
    setTimeout: () => 0,
    encodeURIComponent,
  });

  new Script(
    `${stripImports(challenges)}\n` +
    "globalThis.securityTest = {\n" +
    "  acceptChallenge,\n" +
    "  declineChallenge,\n" +
    "  isSafeFirebaseSegment,\n" +
    "  sendChallenge: window.sendChallenge,\n" +
    "  setIdentity(uid, username) { myUid = uid; myUsername = username; },\n" +
    "};",
    { filename: "challenges.js" },
  ).runInContext(context);
  context.securityTest.setIdentity("recipient", "Recipient");

  return {
    api: context.securityTest,
    controls,
    get: readPath,
    put: writePath,
    keys: () => [...state.keys()],
    location: context.window.location,
    toasts,
    transactionCalls,
  };
}

const avatarPolicy = evaluateAvatarPolicy();
assert.equal(
  avatarPolicy(
    "https://res.cloudinary.com/dszgbkb1f/image/upload/v1/avatar.png",
  ),
  "https://res.cloudinary.com/dszgbkb1f/image/upload/v1/avatar.png",
);
for (const value of [
  "http://res.cloudinary.com/dszgbkb1f/image/upload/avatar.png",
  "https://res.cloudinary.com.evil.example/dszgbkb1f/image/upload/avatar.png",
  "https://res.cloudinary.com/other-cloud/image/upload/avatar.png",
  "https://res.cloudinary.com/dszgbkb1f/raw/upload/avatar.svg",
  "https://user:secret@res.cloudinary.com/dszgbkb1f/image/upload/avatar.png",
  "https://res.cloudinary.com:444/dszgbkb1f/image/upload/avatar.png",
  " https://res.cloudinary.com/dszgbkb1f/image/upload/avatar.png",
  "javascript:alert(1)",
  "data:image/svg+xml,<svg/onload=alert(1)>",
  "x".repeat(2049),
  null,
]) {
  assert.equal(avatarPolicy(value), null, `unsafe avatar accepted: ${value}`);
}

const profileSegmentPolicy = evaluateProfileSegmentPolicy();
const policyHarness = createChallengeHarness();
for (const segmentPolicy of [
  policyHarness.api.isSafeFirebaseSegment,
  profileSegmentPolicy,
]) {
  assert.equal(segmentPolicy("valid_UID-123"), true);
  assert.equal(segmentPolicy("internal space"), true);
  for (const value of [
    "",
    " leading",
    "trailing ",
    "\tleading",
    "line\nbreak",
    "nul\u0000byte",
    "delete\u007Fbyte",
    "a.b",
    "a#b",
    "a$b",
    "a/b",
    "a[b",
    "a]b",
    "__proto__",
    "constructor",
    "prototype",
    "x".repeat(129),
    null,
  ]) {
    assert.equal(segmentPolicy(value), false, `unsafe segment accepted: ${value}`);
  }
}

const pendingChallenge = {
  fromUid: "sender",
  fromUsername: "Sender",
  toUid: "recipient",
  toUsername: "Recipient",
  sentAt: 900,
};

{
  const harness = createChallengeHarness({ challenge: pendingChallenge });
  const results = await Promise.all([
    harness.api.acceptChallenge("sender", clone(pendingChallenge)),
    harness.api.acceptChallenge("sender", clone(pendingChallenge)),
  ]);
  assert.deepEqual(results, [true, true]);

  const gamePaths = harness.keys().filter(path => path.startsWith("games/"));
  assert.deepEqual(gamePaths, ["games/00000000-0000-4000-8000-000000000001"]);
  const game = harness.get(gamePaths[0]);
  assert.equal(game.white.uid, "sender");
  assert.equal(game.black.uid, "recipient");
  assert.deepEqual(game.challenge, {
    fromUid: "sender",
    toUid: "recipient",
  });
  assert.equal(game.whiteTime, 600);
  assert.equal(game.blackTime, 600);
  assert.equal(game.whiteTimeMs, 600_000);
  assert.equal(game.blackTimeMs, 600_000);
  assert.equal(game.activeColor, "white");
  assert.equal(game.clockUpdatedAt, game.createdAt);
  assert.equal(
    harness.get("users/sender/currentGame"),
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    harness.get("users/recipient/currentGame"),
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(harness.get("challenges/recipient/sender"), null);

  const staleResult = await harness.api.acceptChallenge(
    "sender",
    clone(pendingChallenge),
  );
  assert.equal(staleResult, false);
  assert.equal(
    harness.keys().filter(path => path.startsWith("games/")).length,
    1,
  );
}

{
  const harness = createChallengeHarness({ challenge: pendingChallenge });
  harness.controls.failGameTransactions = 1;
  assert.equal(
    await harness.api.acceptChallenge("sender", clone(pendingChallenge)),
    false,
  );
  const claimed = harness.get("challenges/recipient/sender");
  assert.equal(
    claimed.acceptedGameId,
    "00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    await harness.api.acceptChallenge("sender", clone(pendingChallenge)),
    true,
  );
  assert.deepEqual(
    harness.keys().filter(path => path.startsWith("games/")),
    ["games/00000000-0000-4000-8000-000000000001"],
  );
}

{
  const harness = createChallengeHarness({ challenge: pendingChallenge });
  harness.controls.failUpdates = 1;
  assert.equal(
    await harness.api.acceptChallenge("sender", clone(pendingChallenge)),
    false,
  );
  const gamePath = "games/00000000-0000-4000-8000-000000000001";
  const existingGame = harness.get(gamePath);
  existingGame.moves = ["e4"];
  harness.put(gamePath, existingGame);

  assert.equal(
    await harness.api.acceptChallenge("sender", clone(pendingChallenge)),
    true,
  );
  assert.deepEqual(harness.get(gamePath).moves, ["e4"]);
  assert.equal(harness.get(gamePath).createdAt, existingGame.createdAt);
}

{
  const acceptedChallenge = {
    ...pendingChallenge,
    acceptedGameId: "existing-game",
    acceptedAt: 800,
  };
  const occupiedGame = {
    white: { uid: "attacker" },
    black: { uid: "recipient" },
    challenge: { fromUid: "attacker", toUid: "recipient" },
  };
  const harness = createChallengeHarness({
    challenge: acceptedChallenge,
    initialEntries: [["games/existing-game", occupiedGame]],
  });
  assert.equal(
    await harness.api.acceptChallenge("sender", clone(acceptedChallenge)),
    false,
  );
  assert.deepEqual(harness.get("games/existing-game"), occupiedGame);
  assert.equal(harness.get("users/sender/currentGame"), null);
  assert.ok(harness.get("challenges/recipient/sender"));
}

{
  const harness = createChallengeHarness({ challenge: pendingChallenge });
  assert.equal(await harness.api.declineChallenge("sender"), true);
  assert.equal(harness.get("challenges/recipient/sender"), null);
}

{
  const acceptedChallenge = {
    ...pendingChallenge,
    acceptedGameId: "claimed-game",
    acceptedAt: 800,
  };
  const harness = createChallengeHarness({ challenge: acceptedChallenge });
  assert.equal(await harness.api.declineChallenge("sender"), false);
  assert.deepEqual(
    harness.get("challenges/recipient/sender"),
    acceptedChallenge,
  );
}

{
  const harness = createChallengeHarness();
  harness.controls.failChallengeTransactions = 1;
  assert.equal(
    await harness.api.sendChallenge("friend", "Friend"),
    false,
  );
  assert.equal(harness.get("challenges/friend/recipient"), null);
  assert.equal(
    await harness.api.sendChallenge("friend", "Friend"),
    true,
  );
  assert.equal(
    harness.get("challenges/friend/recipient").fromUid,
    "recipient",
  );
}

{
  const claimedChallenge = {
    fromUid: "recipient",
    fromUsername: "Recipient",
    toUid: "friend",
    toUsername: "Friend",
    sentAt: 700,
    acceptedGameId: "claimed-game",
    acceptedAt: 800,
  };
  const harness = createChallengeHarness({
    initialEntries: [
      ["challenges/friend/recipient", claimedChallenge],
    ],
  });
  assert.equal(
    await harness.api.sendChallenge("friend", "Friend"),
    false,
  );
  assert.deepEqual(
    harness.get("challenges/friend/recipient"),
    claimedChallenge,
  );
}

console.log("security smoke and behavioral checks passed");
