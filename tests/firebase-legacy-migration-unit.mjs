import assert from "node:assert/strict";
import test from "node:test";

import {
  START_FEN,
  MigrationInputError,
  applyPlanToRoot,
  assertApplyPlanSafe,
  buildLegacyGameMigration,
  contiguousSanMoves,
  createChessJsReplay,
  createFirebaseRestClient,
  migrationPlanSignature,
  parseCliArgs,
  planLegacyMigration,
  runCli,
  validateCliConfig,
  valuesEqual,
  verifyAppliedPlan,
} from "../scripts/firebase-legacy-migrate.mjs";

const AFTER_E4_E5_FEN = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";

function replayKnownLine(moves) {
  const key = moves.join(" ");
  if (key === "") return { fen: START_FEN, turn: "w" };
  if (key === "e4 e5") return { fen: AFTER_E4_E5_FEN, turn: "w" };
  throw new MigrationInputError("Illegal test SAN.", "illegal-san");
}

function canonicalRoot() {
  return {
    usernames: {
      white_1: "whiteUid",
      black_1: "blackUid",
      sender_1: "senderUid",
      target_1: "targetUid",
    },
    users: {
      whiteUid: {
        username: "White_1",
        currentGame: "game-1",
        rating: 800,
      },
      blackUid: {
        username: "Black_1",
        currentGame: "game-1",
        rating: 805,
      },
      senderUid: {
        username: "Sender_1",
        currentGame: null,
      },
      targetUid: {
        username: "Target_1",
        currentGame: null,
      },
    },
    games: {
      "game-1": {
        white: { uid: "whiteUid", username: "White_1" },
        black: { uid: "blackUid", username: "Black_1" },
        fen: AFTER_E4_E5_FEN,
        moves: { 0: "e4", 1: "e5" },
        status: "playing",
        timeControl: "blitz",
        whiteTime: 291,
        blackTime: 287,
        createdAt: 123456,
      },
    },
    challenges: {
      targetUid: {
        senderUid: {
          fromUid: "senderUid",
          fromUsername: "Sender_1",
          toUid: "targetUid",
          toUsername: "Target_1",
          sentAt: 900,
        },
      },
    },
    queue: {
      rapid: {
        staleUid: {
          uid: "staleUid",
          username: "Old_Player",
          joinedAt: 1,
        },
      },
    },
    tournaments: {
      "tournament-1": {
        queue: {
          claimUid: {
            uid: "claimUid",
            username: "Claim_1",
            joinedAt: 10,
            state: "claiming",
            stateAt: 20,
            peerUid: "peerUid",
            gameId: "game-claim",
          },
        },
      },
    },
    untouched: {
      value: 42,
    },
  };
}

test("chess.js replay adapter requires legal strict SAN", () => {
  class FakeChess {
    constructor() {
      this.moves = [];
    }

    move(san, options) {
      assert.deepEqual(options, { strict: true });
      if (!["e4", "e5"].includes(san) || this.moves.length >= 2) throw new Error("illegal");
      this.moves.push(san);
      return { san };
    }

    fen() {
      return this.moves.length === 2 ? AFTER_E4_E5_FEN : START_FEN;
    }

    turn() {
      return this.moves.length % 2 === 0 ? "w" : "b";
    }
  }

  const replay = createChessJsReplay(FakeChess);
  assert.deepEqual(replay(["e4", "e5"]), { fen: AFTER_E4_E5_FEN, turn: "w" });
  assert.throws(() => replay(["e4", "Qa9"]), error => error.code === "illegal-san");
});

test("numeric SAN keys must be canonical and contiguous", () => {
  assert.deepEqual(contiguousSanMoves({ 0: "e4", 1: "e5" }), ["e4", "e5"]);
  assert.deepEqual(contiguousSanMoves(["e4", "e5"]), ["e4", "e5"]);
  assert.throws(
    () => contiguousSanMoves({ 0: "e4", 2: "e5" }),
    error => error.code === "noncontiguous-moves",
  );
  assert.throws(
    () => contiguousSanMoves({ "00": "e4" }),
    error => error.code === "noncontiguous-moves",
  );
});

test("moved legacy game migrates only with exact replay, clocks, accounts, and pointers", () => {
  const root = canonicalRoot();
  const planned = buildLegacyGameMigration(
    root,
    "game-1",
    root.games["game-1"],
    replayKnownLine,
  );

  assert.equal(planned.after.schemaVersion, 2);
  assert.equal(planned.after.kind, "queue");
  assert.equal(planned.after.createdBy, "whiteUid");
  assert.deepEqual(planned.after.moves, root.games["game-1"].moves);
  assert.deepEqual(planned.after.white, root.games["game-1"].white);
  assert.deepEqual(planned.after.black, root.games["game-1"].black);
  assert.equal(planned.after.status, "playing");
  assert.deepEqual(planned.after.clocks, { white: 291, black: 287 });
  assert.deepEqual(planned.after.position, {
    ply: 2,
    turnUid: "whiteUid",
    fen: AFTER_E4_E5_FEN,
    lastMove: "e5",
  });
  assert.equal(planned.after.fen, AFTER_E4_E5_FEN);
  assert.equal(planned.after.whiteTime, 291);
  assert.equal(planned.after.blackTime, 287);
});

test("legacy rapid games with canonical challenge markers stay challenges", () => {
  const root = canonicalRoot();
  root.games["game-1"] = {
    white: { uid: "whiteUid", username: "White_1" },
    black: { uid: "blackUid", username: "Black_1" },
    fen: START_FEN,
    moves: {},
    status: "playing",
    timeControl: "rapid",
    whiteTime: 600,
    blackTime: 600,
    createdAt: 123456,
    challenge: {
      fromUid: "whiteUid",
      toUid: "blackUid",
    },
  };

  const planned = buildLegacyGameMigration(
    root,
    "game-1",
    root.games["game-1"],
    replayKnownLine,
  );

  assert.equal(planned.after.kind, "challenge");
  assert.equal(planned.after.createdBy, "blackUid");
  assert.equal(planned.after.timeControl, "rapid");
  assert.deepEqual(planned.after.clocks, { white: 600, black: 600 });
});

test("canonical millisecond clock metadata is preserved after exact validation", () => {
  const root = canonicalRoot();
  Object.assign(root.games["game-1"], {
    whiteTimeMs: 290500,
    blackTimeMs: 286500,
    activeColor: "white",
    clockUpdatedAt: 123500,
  });

  const planned = buildLegacyGameMigration(
    root,
    "game-1",
    root.games["game-1"],
    replayKnownLine,
  );

  assert.equal(planned.after.whiteTimeMs, 290500);
  assert.equal(planned.after.blackTimeMs, 286500);
  assert.equal(planned.after.activeColor, "white");
  assert.equal(planned.after.clockUpdatedAt, 123500);
});

test("finished legacy games are reported and left unchanged", () => {
  const root = canonicalRoot();
  root.games["game-1"].status = "finished";
  const plan = planLegacyMigration(root, {
    replaySan: replayKnownLine,
    now: 1_000_000,
  });

  assert.equal(plan.summary.finishedLegacyGames, 1);
  assert.deepEqual(plan.legacyGameFindings, [{
    path: "games/game-1",
    code: "finished-game-left-unchanged",
  }]);
  assert.equal(plan.mutations.some(entry => entry.path === "games/game-1"), false);
  assert.equal(plan.skipped.some(entry => entry.path === "games/game-1"), false);
});

test("migration accepts canonical legacy usernames that use safe punctuation", () => {
  const root = canonicalRoot();
  root.users.whiteUid.username = "White Name!";
  root.usernames["white name!"] = "whiteUid";
  delete root.usernames.white_1;
  root.games["game-1"].white.username = "White Name!";

  const planned = buildLegacyGameMigration(
    root,
    "game-1",
    root.games["game-1"],
    replayKnownLine,
  );

  assert.equal(planned.after.white.username, "White Name!");
});

test("unsafe legacy games are skipped instead of guessed", () => {
  const cases = [
    {
      mutate(game) {
        game.moves = { 0: "e4", 2: "e5" };
      },
      code: "noncontiguous-moves",
    },
    {
      mutate(game) {
        game.moves = { 0: "illegal" };
        game.fen = "wrong";
      },
      replay() {
        throw new MigrationInputError("illegal", "illegal-san");
      },
      code: "illegal-san",
    },
    {
      mutate(game) {
        game.fen = START_FEN;
      },
      code: "fen-mismatch",
    },
    {
      mutate(game) {
        delete game.blackTime;
      },
      code: "missing-clock",
    },
    {
      mutate(game) {
        game.whiteTimeMs = 290500;
      },
      code: "partial-clock-metadata",
    },
    {
      mutate(game, root) {
        root.users.blackUid.currentGame = "another-game";
      },
      code: "current-game-mismatch",
    },
    {
      mutate(game, root) {
        root.users.whiteUid.username = "Changed_1";
      },
      code: "noncanonical-account",
    },
  ];

  for (const item of cases) {
    const root = canonicalRoot();
    item.mutate(root.games["game-1"], root);
    const plan = planLegacyMigration(root, {
      replaySan: item.replay ?? replayKnownLine,
      now: 1_000_000,
    });
    const skipped = plan.skipped.find(entry => entry.path === "games/game-1");
    assert.equal(skipped?.code, item.code);
    assert.equal(plan.mutations.some(entry => entry.path === "games/game-1"), false);
  }
});

test("apply is blocked until every skipped legacy record is resolved", () => {
  assert.doesNotThrow(() => assertApplyPlanSafe({ skipped: [] }));
  assert.throws(
    () => assertApplyPlanSafe({
      skipped: [{ type: "game", path: "games/bad", code: "invalid-game" }],
    }),
    error => error.code === "skipped-records",
  );
});

test("malformed game and challenge containers block apply", () => {
  const cases = [
    root => {
      root.games = "malformed";
    },
    root => {
      root.challenges = "malformed";
    },
    root => {
      root.challenges.targetUid = "malformed";
    },
  ];

  for (const mutate of cases) {
    const root = canonicalRoot();
    mutate(root);
    const plan = planLegacyMigration(root, {
      replaySan: replayKnownLine,
      now: 1_000_000,
    });
    assert.ok(plan.skipped.length > 0);
    assert.throws(
      () => assertApplyPlanSafe(plan),
      error => error.code === "skipped-records",
    );
  }
});

test("an unmoved legacy challenge receives exact default rapid clocks", () => {
  const root = canonicalRoot();
  root.games["game-1"] = {
    white: { uid: "whiteUid", username: "White_1" },
    black: { uid: "blackUid", username: "Black_1" },
    status: "playing",
    createdAt: 123456,
  };
  const planned = buildLegacyGameMigration(
    root,
    "game-1",
    root.games["game-1"],
    replayKnownLine,
  );
  assert.equal(planned.after.kind, "challenge");
  assert.equal(planned.after.createdBy, "blackUid");
  assert.equal(planned.after.timeControl, "rapid");
  assert.deepEqual(planned.after.clocks, { white: 600, black: 600 });
  assert.deepEqual(planned.after.position, {
    ply: 0,
    turnUid: "whiteUid",
    fen: START_FEN,
  });
});

test("only canonical pending challenges gain state open", () => {
  const root = canonicalRoot();
  root.challenges.targetUid.badUid = {
    fromUid: "badUid",
    fromUsername: "Spoofed_1",
    toUid: "targetUid",
    toUsername: "Target_1",
    sentAt: 901,
  };

  const plan = planLegacyMigration(root, {
    replaySan: replayKnownLine,
    now: 1_000_000,
  });
  const challengeMutation = plan.mutations.find(item => item.type === "challenge-open");
  assert.equal(challengeMutation.path, "challenges/targetUid/senderUid");
  assert.deepEqual(challengeMutation.after, {
    ...root.challenges.targetUid.senderUid,
    state: "open",
  });
  assert.equal(plan.mutations.some(item => item.path.includes("badUid")), false);
  assert.equal(
    plan.skipped.find(item => item.path.includes("badUid"))?.code,
    "noncanonical-account",
  );
});

test("stale regular and tournament queues are findings only", () => {
  const root = canonicalRoot();
  const plan = planLegacyMigration(root, {
    replaySan: replayKnownLine,
    now: 1_000_000,
    staleAfterMs: 300_000,
  });

  assert.deepEqual(
    plan.queueFindings.map(item => item.code).sort(),
    ["stale-legacy-queue-entry", "stale-queue-claim"],
  );
  assert.equal(
    plan.mutations.some(item => item.path.startsWith("queue/") || item.path.includes("/queue/")),
    false,
  );
});

test("root transaction plan preserves unrelated data and all guarded identities", () => {
  const root = canonicalRoot();
  const plan = planLegacyMigration(root, {
    replaySan: replayKnownLine,
    now: 1_000_000,
  });
  const beforeUsers = structuredClone(root.users);
  const beforeQueues = structuredClone({
    queue: root.queue,
    tournamentQueue: root.tournaments["tournament-1"].queue,
  });

  const applied = applyPlanToRoot(root, plan);
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.value.users, beforeUsers);
  assert.deepEqual(applied.value.queue, beforeQueues.queue);
  assert.deepEqual(applied.value.tournaments["tournament-1"].queue, beforeQueues.tournamentQueue);
  assert.deepEqual(applied.value.untouched, { value: 42 });
  assert.equal(applied.value.games["game-1"].status, "playing");
  assert.deepEqual(applied.value.games["game-1"].moves, { 0: "e4", 1: "e5" });
  assert.equal(applied.value.challenges.targetUid.senderUid.state, "open");
  assert.equal(verifyAppliedPlan(applied.value, plan).ok, true);
});

test("transaction guards fail closed on moves, account, status, or currentGame drift", () => {
  const driftCases = [
    root => {
      root.games["game-1"].moves[1] = "c5";
    },
    root => {
      root.users.whiteUid.rating = 900;
    },
    root => {
      root.games["game-1"].status = "finished";
    },
    root => {
      root.users.blackUid.currentGame = "other-game";
    },
  ];

  for (const drift of driftCases) {
    const root = canonicalRoot();
    const plan = planLegacyMigration(root, {
      replaySan: replayKnownLine,
      now: 1_000_000,
    });
    const changed = structuredClone(root);
    drift(changed);
    assert.equal(applyPlanToRoot(changed, plan).ok, false);
  }
});

test("plan signature changes when guarded content changes", () => {
  const root = canonicalRoot();
  const first = planLegacyMigration(root, {
    replaySan: replayKnownLine,
    now: 1_000_000,
  });
  const changed = structuredClone(root);
  changed.users.whiteUid.rating += 1;
  const second = planLegacyMigration(changed, {
    replaySan: replayKnownLine,
    now: 1_000_000,
  });
  assert.notEqual(migrationPlanSignature(first), migrationPlanSignature(second));
});

test("CLI is dry-run by default and apply requires exact safety gates", () => {
  const dryRun = parseCliArgs(["--project", "faithchess"]);
  assert.equal(dryRun.apply, false);
  assert.equal(dryRun.backup, null);
  assert.deepEqual(validateCliConfig(dryRun, {
    FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/",
  }), {
    databaseUrl: "https://faithchess-default-rtdb.firebaseio.com/",
  });

  const apply = parseCliArgs([
    "--apply",
    "--project",
    "faithchess",
    "--backup",
    "firebase-backups/migration.firebase-backup.json",
  ]);
  assert.equal(apply.apply, true);
  assert.equal(apply.backup, "firebase-backups/migration.firebase-backup.json");
  assert.doesNotThrow(() => validateCliConfig(apply, {
    FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/",
  }));

  assert.throws(
    () => validateCliConfig(parseCliArgs(["--apply", "--project", "faithchess"]), {
      FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/",
    }),
    error => error.code === "backup-required",
  );
  assert.throws(
    () => validateCliConfig(parseCliArgs([
      "--apply",
      "--project",
      "faithchess",
      "--backup",
      "migration-backup.json",
    ]), {
      FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/",
    }),
    error => error.code === "backup-required",
  );
  assert.throws(
    () => validateCliConfig(parseCliArgs([
      "--apply",
      "--project",
      "faithchess",
      "--backup",
      "migration.firebase-backup.json",
    ]), {
      FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/",
    }),
    error => error.code === "unsafe-backup-path",
  );
  assert.throws(
    () => validateCliConfig(parseCliArgs(["--project", "other"]), {
      FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/",
    }),
    error => error.code === "project-confirmation",
  );
  assert.throws(
    () => validateCliConfig(dryRun, {}),
    error => error.code === "database-url-required",
  );
  assert.throws(
    () => validateCliConfig(dryRun, {
      FIREBASE_DATABASE_URL: "https://other-default-rtdb.firebaseio.com/",
    }),
    error => error.code === "invalid-database-url",
  );
  assert.throws(
    () => validateCliConfig(dryRun, {
      FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com:8443/",
    }),
    error => error.code === "invalid-database-url",
  );
  assert.throws(
    () => parseCliArgs(["--service-account=do-not-print-this"]),
    error => error.code === "unknown-argument"
      && !error.message.includes("do-not-print-this"),
  );
});

test("REST migration writes are conditional on the latest Firebase ETag", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "GET") {
      return new Response(JSON.stringify({ users: {}, ".priority": 10 }), {
        status: 200,
        headers: { ETag: "\"root-v1\"" },
      });
    }
    return new Response(null, { status: 204 });
  };
  const rest = createFirebaseRestClient(
    "https://faithchess-default-rtdb.firebaseio.com/",
    async () => ({ Authorization: "Bearer test-token" }),
    fetchImpl,
  );

  const root = await rest.readRoot();
  assert.deepEqual(root, {
    value: { users: {}, ".priority": 10 },
    etag: "\"root-v1\"",
  });
  await rest.writeRoot(root.value, root.etag);
  assert.equal(requests[0].options.headers["X-Firebase-ETag"], "true");
  assert.match(requests[0].url, /\.json\?format=export$/);
  assert.equal(requests[1].options.headers["If-Match"], "\"root-v1\"");
  assert.equal(requests[1].options.headers.Authorization, "Bearer test-token");
  assert.match(requests[1].url, /\.json\?print=silent$/);
  assert.equal(JSON.parse(requests[1].options.body)[".priority"], 10);

  const conflicting = createFirebaseRestClient(
    "https://faithchess-default-rtdb.firebaseio.com/",
    async () => ({}),
    async () => new Response(null, { status: 412 }),
  );
  await assert.rejects(
    () => conflicting.writeRoot({}, "\"stale\""),
    error => error.code === "etag-conflict",
  );
});

test("value comparison is key-order independent for transaction guards", () => {
  assert.equal(valuesEqual({ b: 2, a: 1 }, { a: 1, b: 2 }), true);
});

test("CLI dry run reads once and never writes or creates a backup", async () => {
  const events = [];
  const rest = {
    async readRoot() {
      events.push("read");
      return { value: canonicalRoot(), etag: "\"root-v1\"" };
    },
    async writeRoot() {
      throw new Error("dry run must not write");
    },
  };

  await runCli(
    ["--project", "faithchess"],
    { FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/" },
    {
      logger: { log() {} },
      loadChessReplay: async () => replayKnownLine,
      loadAuthenticatedRest: async () => rest,
      writeExclusiveBackup: async () => {
        throw new Error("dry run must not create a backup");
      },
      now: () => 1_000_000,
    },
  );

  assert.deepEqual(events, ["read"]);
});

test("CLI apply backs up the latest export before the guarded write", async () => {
  const events = [];
  let stored = canonicalRoot();
  let wrote = false;
  const rest = {
    async readRoot() {
      events.push("read");
      return {
        value: structuredClone(stored),
        etag: wrote ? "\"root-v2\"" : "\"root-v1\"",
      };
    },
    async writeRoot(value, etag) {
      events.push("write");
      assert.equal(etag, "\"root-v1\"");
      stored = structuredClone(value);
      wrote = true;
    },
  };

  await runCli(
    [
      "--apply",
      "--project",
      "faithchess",
      "--backup",
      "firebase-backups/test.firebase-backup.json",
    ],
    { FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/" },
    {
      logger: { log() {} },
      loadChessReplay: async () => replayKnownLine,
      loadAuthenticatedRest: async () => rest,
      writeExclusiveBackup: async (path, value) => {
        events.push("backup");
        assert.equal(path, "firebase-backups/test.firebase-backup.json");
        assert.deepEqual(value, canonicalRoot());
      },
      now: () => 1_000_000,
    },
  );

  assert.deepEqual(events, ["read", "read", "backup", "write", "read"]);
  assert.equal(stored.games["game-1"].schemaVersion, 2);
  assert.equal(stored.challenges.targetUid.senderUid.state, "open");
});

test("CLI aborts before backup and write when the reread plan changes", async () => {
  const events = [];
  let reads = 0;
  const rest = {
    async readRoot() {
      events.push("read");
      const value = canonicalRoot();
      if (reads++ > 0) value.users.whiteUid.rating += 1;
      return { value, etag: `"root-v${reads}"` };
    },
    async writeRoot() {
      events.push("write");
    },
  };

  await assert.rejects(
    () => runCli(
      [
        "--apply",
        "--project",
        "faithchess",
        "--backup",
        "firebase-backups/test.firebase-backup.json",
      ],
      { FIREBASE_DATABASE_URL: "https://faithchess-default-rtdb.firebaseio.com/" },
      {
        logger: { log() {} },
        loadChessReplay: async () => replayKnownLine,
        loadAuthenticatedRest: async () => rest,
        writeExclusiveBackup: async () => {
          events.push("backup");
        },
        now: () => 1_000_000,
      },
    ),
    error => error.code === "reread-mismatch",
  );

  assert.deepEqual(events, ["read", "read"]);
});
