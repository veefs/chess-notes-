import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(testDir, "..");
const source = fs.readFileSync(path.join(rootDir, "play.js"), "utf8");

class MockClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach(value => this.values.add(value));
  }

  remove(...values) {
    values.forEach(value => this.values.delete(value));
  }

  toggle(value, force) {
    if (force === true) this.values.add(value);
    else if (force === false) this.values.delete(value);
    else if (this.values.has(value)) this.values.delete(value);
    else this.values.add(value);
    return this.values.has(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class MockNode {
  constructor(tagName = "div", text = "") {
    this.tagName = tagName.toUpperCase();
    this.nodeType = tagName === "#text" ? 3 : 1;
    this.children = [];
    this.classList = new MockClassList();
    this.className = "";
    this.style = {};
    this.disabled = false;
    this.onclick = null;
    this.dataset = {};
    this._text = text;
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join("");
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener() {}
}

const elements = new Map();
const getElement = id => {
  if (!elements.has(id)) elements.set(id, new MockNode());
  return elements.get(id);
};

const document = {
  body: new MockNode("body"),
  getElementById: getElement,
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: tagName => new MockNode(tagName),
  createTextNode: text => new MockNode("#text", String(text)),
};

class ChessStub {
  constructor() {
    this.movesPlayed = [];
  }

  reset() {
    this.movesPlayed = [];
  }

  move(move) {
    const san = typeof move === "string" ? move : `${move.from}${move.to}`;
    this.movesPlayed.push(san);
    return { from: "e2", to: "e4", san };
  }

  history(options) {
    if (options?.verbose) {
      return this.movesPlayed.map(san => ({ san, captured: undefined }));
    }
    return [...this.movesPlayed];
  }

  fen() {
    return "mock-fen";
  }

  turn() {
    return this.movesPlayed.length % 2 === 0 ? "w" : "b";
  }

  moves() {
    return [];
  }

  game_over() {
    return false;
  }

  in_check() {
    return false;
  }

  in_checkmate() {
    return false;
  }
}

let pieceThemeResolveCalls = 0;
const windowObject = {
  __FAITHCHESS_TEST_MODE__: true,
  getSettings: () => ({ pieceSet: "cburnett", sound: false, legalMoves: true }),
  resolvePieceTheme: pieceSet => {
    pieceThemeResolveCalls += 1;
    return `pieces/${pieceSet}/{piece}.svg`;
  },
  location: {
    href: "https://faith.example/play.html",
    search: "",
  },
  history: {
    replaceState() {},
  },
};

const boardConfigs = [];
const context = {
  window: windowObject,
  document,
  Chess: ChessStub,
  Chessboard: (id, config) => {
    boardConfigs.push({ id, config });
    return {
      destroy() {},
      position() {},
    };
  },
  Audio: class {
    play() {
      return Promise.resolve();
    }
  },
  URL,
  URLSearchParams,
  Date,
  JSON,
  Math,
  Object,
  Array,
  Number,
  String,
  Set,
  Promise,
  console,
  confirm: () => true,
  setTimeout: () => 1,
  clearTimeout() {},
  setInterval: () => 1,
  clearInterval() {},
};

vm.createContext(context);
const script = new vm.Script(source, { filename: "play.js" });
script.runInContext(context);

let checks = 0;
const check = (name, callback) => {
  callback();
  checks += 1;
  console.log(`ok - ${name}`);
};

const checkAsync = async (name, callback) => {
  await callback();
  checks += 1;
  console.log(`ok - ${name}`);
};

const clone = value => value === undefined
  ? undefined
  : JSON.parse(JSON.stringify(value));

function createFirebaseMock(initialState = {}, options = {}) {
  const state = clone(initialState);
  const calls = {
    gets: [],
    transactions: [],
    updates: [],
    unsubscriptions: 0,
  };
  let pushedKey = options.pushedKey || "generated-game";
  let valueListener = null;
  const failTransactionOnce = new Set(options.failTransactionOnce || []);

  const segments = pathValue => String(pathValue || "")
    .split("/")
    .filter(Boolean);
  const readPath = pathValue => {
    let cursor = state;
    for (const segment of segments(pathValue)) {
      if (!cursor || typeof cursor !== "object") return undefined;
      cursor = cursor[segment];
    }
    return cursor;
  };
  const writePath = (pathValue, value) => {
    const parts = segments(pathValue);
    if (parts.length === 0) {
      for (const key of Object.keys(state)) delete state[key];
      Object.assign(state, clone(value));
      return;
    }
    let cursor = state;
    for (const segment of parts.slice(0, -1)) {
      if (!cursor[segment] || typeof cursor[segment] !== "object") {
        cursor[segment] = {};
      }
      cursor = cursor[segment];
    }
    cursor[parts.at(-1)] = clone(value);
  };
  const snapshot = value => ({
    exists: () => value !== undefined && value !== null,
    val: () => clone(value),
  });
  const ref = (_db, pathValue = "") => ({ path: pathValue });

  const api = {
    ref,
    get: async target => {
      calls.gets.push(target.path);
      return snapshot(readPath(target.path));
    },
    push: () => ({ key: pushedKey }),
    update: async (target, updates) => {
      calls.updates.push({
        root: target.path,
        updates: clone(updates),
      });
      for (const [pathValue, value] of Object.entries(updates)) {
        writePath(pathValue, value);
      }
    },
    runTransaction: async (target, updater, transactionOptions) => {
      calls.transactions.push({
        path: target.path,
        options: clone(transactionOptions),
      });
      if (failTransactionOnce.delete(target.path)) {
        throw new Error(`simulated transaction failure: ${target.path}`);
      }
      const current = clone(readPath(target.path));
      const next = updater(current);
      if (next === undefined) {
        return {
          committed: false,
          snapshot: snapshot(readPath(target.path)),
        };
      }
      writePath(target.path, next);
      return {
        committed: true,
        snapshot: snapshot(readPath(target.path)),
      };
    },
    onValue: (_target, callback) => {
      valueListener = callback;
      return () => {
        calls.unsubscriptions += 1;
      };
    },
  };

  return {
    api,
    calls,
    state,
    emitValue: value => valueListener(snapshot(value)),
    setPath: writePath,
    setPushedKey: value => {
      pushedKey = value;
    },
  };
}

check("play.js parses as a classic browser script", () => {
  assert.ok(script);
  assert.equal(source.match(/const params\s*=/g)?.length, 1);
});

check("all play boards use one resolved local piece theme", () => {
  assert.equal(pieceThemeResolveCalls, 1);
  assert.equal(boardConfigs[0].config.pieceTheme, "pieces/cburnett/{piece}.svg");

  const originalListenToGame = context.listenToGame;
  context.listenToGame = () => {};
  windowObject.myUid = "piece-theme-user";
  assert.equal(context.startGame("piece-theme-game", "white", "blitz"), true);
  getElement("goPlayAgain").onclick();
  context.listenToGame = originalListenToGame;

  const recentThemes = boardConfigs.slice(-2)
    .map(entry => entry.config.pieceTheme);
  assert.deepEqual(recentThemes, [
    "pieces/cburnett/{piece}.svg",
    "pieces/cburnett/{piece}.svg",
  ]);
  assert.doesNotMatch(source, /chessboardjs\.com\/img\/chesspieces/);

  const originalResolver = windowObject.resolvePieceTheme;
  windowObject.resolvePieceTheme = () => "https://evil.example/{piece}.svg";
  assert.equal(
    context.resolveLocalPieceTheme("anything"),
    "pieces/cburnett/{piece}.svg"
  );
  windowObject.resolvePieceTheme = originalResolver;
});

check("stored names render as text and unsafe avatar schemes are rejected", () => {
  const maliciousName = "<img src=x onerror=alert(1)>";
  const nameEl = new MockNode("span");
  context.renderPlayerName(nameEl, maliciousName, "gm", true);

  assert.equal(nameEl.textContent, `GM ${maliciousName}`);
  assert.equal(nameEl.children.some(child => child.tagName === "IMG"), false);
  assert.equal(context.safeAvatarUrl("javascript:alert(1)"), null);
  assert.equal(context.safeAvatarUrl("data:image/svg+xml,<svg/>"), null);
  assert.equal(context.safeAvatarUrl("http://remote.example/avatar.png"), null);
  assert.equal(context.safeAvatarUrl("https://cdn.example/avatar.png"), null);
  assert.equal(
    context.safeAvatarUrl("https://res.cloudinary.com/demo/image/upload/avatar.png"),
    "https://res.cloudinary.com/demo/image/upload/avatar.png"
  );
  assert.equal(
    context.safeAvatarUrl("avatars/local.png"),
    "https://faith.example/avatars/local.png"
  );
  assert.equal(
    context.safeAvatarUrl(
      "avatars/local.png",
      "http://localhost:4173/play.html"
    ),
    "http://localhost:4173/avatars/local.png"
  );
  assert.equal(
    context.safeAvatarUrl(
      "http://localhost:4173/avatar.png",
      "https://faith.example/play.html"
    ),
    null
  );

  const avatar = getElement("safeAvatarTest");
  context.setAvatar("safeAvatarTest", "javascript:alert(1)", "A");
  assert.equal(avatar.style.backgroundImage, "");
  assert.equal(avatar.textContent, "A");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.equal(context.normalizeFirebaseKey(" valid-id "), null);
  assert.equal(context.normalizeFirebaseKey("__proto__"), null);
  assert.equal(context.normalizeFirebaseKey("bad/id"), null);
});

check("queue matching resets the selected opponent on every retry", () => {
  const firstQueue = {
    me: { uid: "me", joinedAt: 2 },
    opponent: { uid: "opponent", joinedAt: 1 },
  };
  const firstAttempt = context.planQueueMatch(firstQueue, "me");
  assert.equal(firstAttempt.opponent.uid, "opponent");
  assert.deepEqual(Object.keys(firstQueue).sort(), ["me", "opponent"]);

  let matchedOpponent = firstAttempt.opponent;
  const retryAttempt = context.planQueueMatch(
    { me: { uid: "me", joinedAt: 2 } },
    "me"
  );
  matchedOpponent = retryAttempt.opponent;
  assert.equal(matchedOpponent, null);
  assert.match(source, /matchedOpponent = plan\.opponent/);
});

await checkAsync("game creation publishes game and both pointers atomically", async () => {
  const firebase = createFirebaseMock({}, { pushedKey: "created-game" });
  const events = [];
  const originalUpdate = firebase.api.update;
  firebase.api.update = async (...args) => {
    events.push("update");
    return originalUpdate(...args);
  };

  const gameId = await context.createGame(
    "white-user",
    "White",
    "black-user",
    "Black",
    "blitz",
    {
      firebaseApi: firebase.api,
      db: firebase.state,
      now: () => 12_345,
      startGame: (...args) => events.push(["start", ...args]),
    }
  );

  assert.equal(gameId, "created-game");
  assert.equal(firebase.calls.updates.length, 1);
  assert.equal(firebase.calls.updates[0].root, "");
  assert.deepEqual(
    Object.keys(firebase.calls.updates[0].updates).sort(),
    [
      "games/created-game",
      "users/black-user/currentGame",
      "users/white-user/currentGame",
    ]
  );
  assert.equal(firebase.state.games["created-game"].status, "playing");
  assert.equal(firebase.state.users["white-user"].currentGame, "created-game");
  assert.equal(firebase.state.users["black-user"].currentGame, "created-game");
  assert.deepEqual(events, [
    "update",
    ["start", "created-game", "white", "blitz"],
  ]);

  await assert.rejects(
    context.createGame(
      "bad/user",
      "White",
      "black-user",
      "Black",
      "blitz",
      {
        firebaseApi: firebase.api,
        db: firebase.state,
      }
    ),
    /invalid/
  );
  assert.equal(firebase.calls.updates.length, 1);
});

await checkAsync("queue resume fetches the game and derives only valid membership", async () => {
  const firebase = createFirebaseMock({
    users: {
      me: { currentGame: "resume-game" },
    },
    games: {
      "resume-game": {
        status: "playing",
        timeControl: "rapid",
        white: { uid: "someone-else" },
        black: { uid: "another-user" },
      },
    },
  });
  const starts = [];
  await context.listenForGame("me", "blitz", {
    firebaseApi: firebase.api,
    db: firebase.state,
    startGame: (...args) => starts.push(args),
  });

  await firebase.emitValue("bad/game");
  assert.equal(firebase.calls.gets.length, 0);

  await firebase.emitValue("resume-game");
  assert.deepEqual(starts, []);
  assert.deepEqual(firebase.calls.gets, ["games/resume-game"]);

  firebase.setPath("games/resume-game", {
    status: "waiting",
    timeControl: "rapid",
    white: { uid: "someone-else" },
    black: { uid: "me" },
  });
  await firebase.emitValue("resume-game");
  assert.deepEqual(starts, []);

  firebase.setPath("games/resume-game", {
    status: "playing",
    timeControl: "rapid",
    white: { uid: "someone-else" },
    black: { uid: "me" },
  });
  await firebase.emitValue("resume-game");
  assert.deepEqual(starts, [["resume-game", "black", "rapid"]]);
  assert.equal(firebase.calls.unsubscriptions, 1);

  await assert.rejects(
    context.listenForGame("bad/user", "rapid", {
      firebaseApi: firebase.api,
      db: firebase.state,
    }),
    /invalid/
  );
});

check("tournament context is restored from persisted game data", () => {
  assert.equal(
    context.resolveTournamentContext(null, { tournamentId: "stored-tournament" }),
    "stored-tournament"
  );
  assert.equal(
    context.resolveTournamentContext("url-tournament", {
      tournamentId: "stored-tournament",
    }),
    "stored-tournament"
  );
  assert.equal(
    context.resolveTournamentContext("forged-tournament", { tournamentId: null }),
    null
  );
  assert.equal(
    context.resolveTournamentContext("../unsafe", { tournamentId: null }),
    null
  );
  assert.equal(
    context.colorForUser(
      { white: { uid: "white-id" }, black: { uid: "black-id" } },
      "black-id"
    ),
    "black"
  );
});

await checkAsync("duplicate result processing is atomic, idempotent, and retryable", async () => {
  const firebase = createFirebaseMock({
    users: {
      me: {
        wins: 4,
        losses: 1,
        draws: 2,
        rating: 900,
        currentGame: "game-1",
        gameHistory: {},
      },
    },
    tournaments: {
      arena: {
        players: {
          me: {
            score: 5,
            wins: 2,
            losses: 1,
            draws: 1,
            gamesPlayed: 4,
          },
        },
      },
    },
  }, {
    failTransactionOnce: ["tournaments/arena/players/me"],
  });
  const finishedGame = {
    status: "finished",
    winner: "white",
    result: "1-0",
    finishReason: "checkmate",
    finishedAt: 50_000,
    timeControl: "blitz",
    tournamentId: "arena",
    moves: ["e4", "e5", "Nf3"],
    white: { uid: "me", username: "Me" },
    black: { uid: "opponent", username: "Opponent" },
  };
  const saveOptions = {
    firebaseApi: firebase.api,
    db: firebase.state,
    uid: "me",
    gameId: "game-1",
    color: "white",
    tournamentId: "arena",
    now: () => 60_000,
  };

  await assert.rejects(
    context.saveGameResult(finishedGame, "win", saveOptions),
    /simulated transaction failure/
  );

  const userAfterInterruptedSave = firebase.state.users.me;
  assert.equal(userAfterInterruptedSave.wins, 5);
  assert.equal(userAfterInterruptedSave.rating, 910);
  assert.equal(userAfterInterruptedSave.currentGame, null);
  assert.deepEqual(
    Object.keys(userAfterInterruptedSave.gameHistory),
    ["game-1"]
  );
  assert.equal(
    userAfterInterruptedSave.resultClaims["game-1"].tournamentEligible,
    true
  );
  assert.equal(firebase.state.tournaments.arena.players.me.gamesPlayed, 4);

  const retry = await context.saveGameResult(
    finishedGame,
    "win",
    saveOptions
  );
  assert.equal(retry.profileCommitted, false);
  assert.equal(retry.tournamentCommitted, true);
  assert.equal(firebase.state.users.me.wins, 5);
  assert.equal(firebase.state.users.me.rating, 910);
  assert.equal(firebase.state.tournaments.arena.players.me.score, 7);
  assert.equal(firebase.state.tournaments.arena.players.me.gamesPlayed, 5);

  const replay = await context.saveGameResult(
    finishedGame,
    "win",
    saveOptions
  );
  assert.equal(replay.profileCommitted, false);
  assert.equal(replay.tournamentCommitted, false);
  assert.equal(firebase.state.users.me.wins, 5);
  assert.equal(firebase.state.users.me.rating, 910);
  assert.deepEqual(Object.keys(firebase.state.users.me.gameHistory), ["game-1"]);
  assert.equal(firebase.state.tournaments.arena.players.me.score, 7);
  assert.equal(firebase.state.tournaments.arena.players.me.gamesPlayed, 5);

  await assert.rejects(
    context.saveGameResult(
      {
        ...finishedGame,
        winner: "black",
        result: "0-1",
      },
      "loss",
      saveOptions
    ),
    /conflicted/
  );
  assert.equal(firebase.state.users.me.losses, 1);
  assert.equal(firebase.state.users.me.rating, 910);

  assert.ok(firebase.calls.transactions.length >= 6);
  assert.ok(firebase.calls.transactions.every(
    call => call.options?.applyLocally === false
  ));
});

await checkAsync("legacy game history blocks replay without guessing tournament state", async () => {
  const firebase = createFirebaseMock({
    users: {
      me: {
        wins: 3,
        rating: 850,
        currentGame: "legacy-game",
        gameHistory: {
          oldPushKey: {
            gameId: "legacy-game",
            result: "win",
            myColor: "white",
            playedAt: 40_000,
          },
        },
      },
    },
    tournaments: {
      arena: {
        players: {
          me: {
            score: 6,
            wins: 3,
            gamesPlayed: 3,
          },
        },
      },
    },
  });
  const finishedGame = {
    status: "finished",
    winner: "white",
    result: "1-0",
    finishedAt: 40_000,
    timeControl: "rapid",
    tournamentId: "arena",
    moves: ["d4"],
    white: { uid: "me", username: "Me" },
    black: { uid: "opponent", username: "Opponent" },
  };

  const result = await context.saveGameResult(finishedGame, "win", {
    firebaseApi: firebase.api,
    db: firebase.state,
    uid: "me",
    gameId: "legacy-game",
    color: "white",
  });

  assert.equal(result.legacyResult, true);
  assert.equal(firebase.state.users.me.wins, 3);
  assert.equal(firebase.state.users.me.rating, 850);
  assert.equal(firebase.state.users.me.currentGame, null);
  assert.equal(
    firebase.state.users.me.resultClaims["legacy-game"].tournamentEligible,
    false
  );
  assert.equal(firebase.state.tournaments.arena.players.me.score, 6);
  assert.equal(
    firebase.calls.transactions.some(
      call => call.path.startsWith("tournaments/")
    ),
    false
  );
});

check("draw endings retain their chess-specific reason", () => {
  const base = {
    in_checkmate: () => false,
    in_stalemate: () => false,
    insufficient_material: () => false,
    in_threefold_repetition: () => false,
  };

  assert.equal(
    context.getGameOverReason({ ...base, in_stalemate: () => true }),
    "stalemate"
  );
  assert.equal(
    context.getGameOverReason({ ...base, insufficient_material: () => true }),
    "insufficient"
  );
  assert.equal(
    context.getGameOverReason({
      ...base,
      in_threefold_repetition: () => true,
    }),
    "repetition"
  );
  assert.equal(context.getGameOverReason(base), "drawRule");

  context.showGameOver("draw", "stalemate");
  assert.equal(getElement("goSub").textContent, "by stalemate");
});

check("Firebase readiness polling is bounded and recoverable", () => {
  let now = 0;
  let callbackCount = 0;
  let timeoutCount = 0;
  context.waitForFirebase(
    () => {
      callbackCount += 1;
    },
    {
      timeoutMs: 100,
      pollMs: 25,
      now: () => now,
      schedule: (callback, delay) => {
        now += delay;
        callback();
      },
      onTimeout: () => {
        timeoutCount += 1;
      },
    }
  );
  assert.equal(callbackCount, 0);
  assert.equal(timeoutCount, 1);
  assert.equal(now, 100);

  windowObject.firebaseDb = {};
  windowObject.firebaseAuth = {};
  windowObject.firebaseOnAuthChanged = () => {};
  context.waitForFirebase(() => {
    callbackCount += 1;
  });
  assert.equal(callbackCount, 1);
});

check("timeout and move transitions are guarded by canonical game state", () => {
  const gameState = {
    status: "playing",
    timeControl: "blitz",
    whiteTimeMs: 1000,
    blackTimeMs: 5000,
    whiteTime: 1,
    blackTime: 5,
    activeColor: "white",
    clockUpdatedAt: 10_000,
    createdAt: 10_000,
    moves: [],
    fen: "start",
  };

  assert.equal(
    context.transitionGameState(
      gameState,
      { type: "finish", reason: "timeout" },
      10_999
    ),
    null
  );

  const timedOut = context.transitionGameState(
    gameState,
    { type: "finish", reason: "timeout" },
    11_000
  );
  assert.equal(timedOut.status, "finished");
  assert.equal(timedOut.finishReason, "timeout");
  assert.equal(timedOut.winner, "black");
  assert.equal(timedOut.result, "0-1");
  assert.equal(timedOut.whiteTimeMs, 0);
  assert.equal(
    context.transitionGameState(
      timedOut,
      { type: "finish", reason: "timeout" },
      12_000
    ),
    null
  );

  const moved = context.transitionGameState(
    gameState,
    {
      type: "move",
      previousMoves: [],
      moves: ["e4"],
      fen: "after-e4",
    },
    10_500
  );
  assert.equal(moved.status, "playing");
  assert.equal(moved.activeColor, "black");
  assert.equal(moved.whiteTimeMs, 500);
  assert.deepEqual(Array.from(moved.moves), ["e4"]);

  const lateMove = context.transitionGameState(
    gameState,
    {
      type: "move",
      previousMoves: [],
      moves: ["e4"],
      fen: "after-e4",
    },
    11_000
  );
  assert.equal(lateMove.status, "finished");
  assert.equal(lateMove.finishReason, "timeout");
  assert.deepEqual(Array.from(lateMove.moves), []);

  const offeredDraw = {
    ...gameState,
    drawOffer: "white",
  };
  assert.equal(
    context.transitionGameState(
      offeredDraw,
      { type: "finish", reason: "draw", actorColor: "white" },
      10_100
    ),
    null
  );
  const acceptedDraw = context.transitionGameState(
    offeredDraw,
    { type: "finish", reason: "draw", actorColor: "black" },
    10_100
  );
  assert.equal(acceptedDraw.status, "finished");
  assert.equal(acceptedDraw.result, "1/2-1/2");

  const resignation = context.transitionGameState(
    gameState,
    {
      type: "finish",
      reason: "resign",
      actorColor: "black",
      winner: "black",
    },
    10_100
  );
  assert.equal(resignation.winner, "white");

  assert.doesNotMatch(source, /function pushTimes/);
  assert.doesNotMatch(
    source,
    /games\/\$\{currentGameId\}\/(?:whiteTime|blackTime)/
  );
  assert.match(
    source,
    /runTransaction\(ref\(window\.firebaseDb, `games\/\$\{gameId\}`\)/
  );
  assert.match(source, /\{ applyLocally: false \}/);
});

console.log(`play-smoke: ${checks} checks passed`);
