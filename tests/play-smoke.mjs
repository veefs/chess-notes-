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

const windowObject = {
  __FAITHCHESS_TEST_MODE__: true,
  getSettings: () => ({ pieceSet: "cburnett", sound: false, legalMoves: true }),
  location: {
    href: "https://faith.example/play.html",
    search: "",
  },
  history: {
    replaceState() {},
  },
};

const context = {
  window: windowObject,
  document,
  Chess: ChessStub,
  Chessboard: () => ({
    destroy() {},
    position() {},
  }),
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

check("play.js parses as a classic browser script", () => {
  assert.ok(script);
  assert.equal(source.match(/const params\s*=/g)?.length, 1);
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
  assert.equal(
    context.safeAvatarUrl("https://cdn.example/avatar.png"),
    "https://cdn.example/avatar.png"
  );
  assert.equal(
    context.safeAvatarUrl("avatars/local.png"),
    "https://faith.example/avatars/local.png"
  );

  const avatar = getElement("safeAvatarTest");
  context.setAvatar("safeAvatarTest", "javascript:alert(1)", "A");
  assert.equal(avatar.style.backgroundImage, "");
  assert.equal(avatar.textContent, "A");
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
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
