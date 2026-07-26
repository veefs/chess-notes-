import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const flush = () => new Promise((resolve) => setImmediate(resolve));

let passed = 0;
async function test(name, callback) {
  await callback();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(...values) {
    values.forEach((value) => this.values.add(value));
  }

  remove(...values) {
    values.forEach((value) => this.values.delete(value));
  }

  toggle(value, force) {
    if (force === true) {
      this.values.add(value);
      return true;
    }
    if (force === false) {
      this.values.delete(value);
      return false;
    }
    if (this.values.has(value)) {
      this.values.delete(value);
      return false;
    }
    this.values.add(value);
    return true;
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.classList = new FakeClassList();
    this.style = {};
    this.textContent = "";
    this.listeners = new Map();
    this.parentElement = null;
    this.childrenBySelector = new Map();
  }

  set innerHTML(_) {
    throw new Error(`unsafe innerHTML write on ${this.id}`);
  }

  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }

  closest() {
    return this.parentElement || this;
  }

  querySelector(selector) {
    return this.childrenBySelector.get(selector) || null;
  }
}

function makeDocument(ids = []) {
  const elements = new Map(ids.map((id) => [id, new FakeElement(id)]));
  return {
    body: {
      classList: new FakeClassList(),
      setAttribute() {},
    },
    elements,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener() {},
  };
}

function createTimerHarness() {
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(callback, delay = 0) {
      const id = nextId++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    runNext() {
      const next = [...timers.entries()]
        .sort((left, right) => left[1].delay - right[1].delay || left[0] - right[0])[0];
      assert.ok(next, "expected a queued timer");
      timers.delete(next[0]);
      next[1].callback();
    },
    count() {
      return timers.size;
    },
  };
}

function responseJson(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value;
    },
  };
}

function responseText(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return value;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

await test("settings recover from malformed storage and normalize themes", () => {
  const document = makeDocument();
  const warnings = [];
  let storedSettings = "{broken";
  const context = {
    window: null,
    document,
    localStorage: {
      getItem() {
        return storedSettings;
      },
      setItem() {},
    },
    console: {
      warn(...args) {
        warnings.push(args);
      },
      error() {},
    },
    setTimeout,
  };
  context.window = context;
  vm.runInNewContext(read("settings.js"), context, { filename: "settings.js" });

  assert.deepEqual(
    JSON.parse(JSON.stringify(context.getSettings())),
    {
      darkMode: true,
      boardTheme: "classic",
      pieceSet: "cburnett",
      sound: true,
      legalMoves: true,
      animation: true,
      emailNotif: false,
    },
  );
  assert.equal(warnings.length >= 1, true);
  assert.equal(context.resolvePieceTheme("cburnett"), "pieces/cburnett/{piece}.svg");
  assert.equal(context.resolvePieceTheme("staunty"), "pieces/staunty/{piece}.svg");
  assert.equal(context.resolvePieceTheme("maestro"), "pieces/maestro/{piece}.svg");
  assert.equal(context.resolvePieceTheme("monarchy"), "pieces/monarchy/{piece}.webp");
  assert.equal(context.resolvePieceTheme("libra"), "pieces/cburnett/{piece}.svg");
  assert.equal(context.resolvePieceTheme("../../remote"), "pieces/cburnett/{piece}.svg");

  storedSettings = JSON.stringify({
    darkMode: "false",
    boardTheme: "unknown",
    pieceSet: "remote-theme",
    sound: false,
    legalMoves: true,
  });
  const normalized = context.getSettings();
  assert.equal(normalized.darkMode, true);
  assert.equal(normalized.boardTheme, "classic");
  assert.equal(normalized.pieceSet, "cburnett");
  assert.equal(normalized.sound, false);

  const pieceSetMarkup = read("settings.html").match(
    /<select[^>]+id="pieceSet"[^>]*>[\s\S]*?<\/select>/i,
  )?.[0];
  assert.ok(pieceSetMarkup, "settings must expose the piece-set selector");
  const selectableThemes = [
    ...pieceSetMarkup.matchAll(/<option\s+value="([^"]+)"/gi),
  ].map((match) => match[1]);

  for (const theme of selectableThemes) {
    if (theme === "libra") {
      assert.equal(context.resolvePieceTheme(theme), "pieces/cburnett/{piece}.svg");
      continue;
    }
    const extension = theme === "monarchy" ? "webp" : "svg";
    assert.equal(
      context.resolvePieceTheme(theme),
      `pieces/${theme}/{piece}.${extension}`,
      `${theme} should resolve to its complete local piece directory`,
    );
    for (const piece of ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"]) {
      const asset = context.resolvePieceTheme(theme).replace("{piece}", piece);
      assert.equal(path.extname(asset), `.${extension}`);
      assert.equal(fs.existsSync(path.join(root, asset)), true, `missing ${asset}`);
    }
  }
});

await test("offline puzzle pack is small, immutable, and provenance-labelled", () => {
  const csv = read("lichess_db_puzzles.csv");
  assert.equal(csv.startsWith("version https://git-lfs.github.com/spec/v1"), false);
  assert.equal(Buffer.byteLength(csv) < 16 * 1024, true);
  assert.equal(csv.trim().split(/\r?\n/).length, 8);

  const context = { window: null };
  context.window = context;
  vm.runInNewContext(read("puzzles-data.js"), context, { filename: "puzzles-data.js" });
  const data = context.FAITHCHESS_PUZZLE_DATA;
  assert.equal(data.sourceRevision, "006c3249b387e72e5033ea9a20630dc7637934b2");
  assert.equal(data.sampleRange, "bytes=0-65535");
  assert.equal(data.license, "CC0");
  assert.equal(data.puzzles.length, 7);
  assert.equal(Object.isFrozen(data), true);
  assert.equal(Object.isFrozen(data.puzzles[0].solution), true);

  const csvRows = csv.trim().split(/\r?\n/).slice(1).map((line) => {
    const [id, fen, moves, rating] = line.split(",");
    return { id, fen, solution: moves.split(" "), rating: Number(rating) };
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(data.puzzles)),
    csvRows,
    "the executable pack and reviewable CSV must contain the same rows",
  );

  const attributes = read(".gitattributes");
  assert.match(
    attributes,
    /^\/lichess_db_puzzles\.csv -filter diff merge text eol=lf$/m,
  );
});

await test("puzzles start offline, bound remote reads, lock turns, and keep underpromotions", async () => {
  const ids = [
    "board",
    "sideToMove",
    "puzzleRating",
    "puzzleStreak",
    "solutionMoves",
    "puzzleDataStatus",
    "retryPuzzleDataBtn",
    "puzzle-popup",
    "retryBtn",
    "exitBtn",
    "viewSolutionBtn",
  ];
  const document = makeDocument(ids);
  const popup = document.getElementById("puzzle-popup");
  popup.childrenBySelector.set("#puzzle-title", new FakeElement("puzzle-title"));
  popup.childrenBySelector.set("#puzzle-desc", new FakeElement("puzzle-desc"));
  document.getElementById("solutionMoves").parentElement = new FakeElement("solution-row");

  const timers = createTimerHarness();
  const boardConfigs = [];
  const moveLog = [];

  class FakeChess {
    constructor() {
      this.load("8/8/8/8/8/8/8/8 w - - 0 1");
    }

    load(fen) {
      if (typeof fen !== "string" || fen.split(" ").length < 2) return false;
      this.currentFen = fen;
      this.currentTurn = fen.split(" ")[1];
      return true;
    }

    turn() {
      return this.currentTurn;
    }

    move(move) {
      if (
        !move
        || !/^[a-h][1-8]$/.test(move.from)
        || !/^[a-h][1-8]$/.test(move.to)
      ) {
        return null;
      }
      const result = {
        from: move.from,
        to: move.to,
        promotion: move.promotion,
        san: `${move.from}${move.to}${move.promotion || ""}`,
      };
      moveLog.push(result);
      this.currentTurn = this.currentTurn === "w" ? "b" : "w";
      return result;
    }

    fen() {
      return this.currentFen;
    }

    moves() {
      return [];
    }

    in_check() {
      return false;
    }
  }

  function Chessboard(_id, config) {
    boardConfigs.push(config);
    return {
      position() {},
      orientation() {},
    };
  }

  class Audio {
    play() {
      return Promise.resolve();
    }
  }

  const warnings = [];
  const context = {
    window: null,
    document,
    Chess: FakeChess,
    Chessboard,
    Audio,
    TextDecoder,
    Uint8Array,
    AbortController,
    console: {
      warn(...args) {
        warnings.push(args);
      },
      error() {},
    },
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    fetch: async () => {
      throw new Error("offline");
    },
    Math,
    __FAITHCHESS_TEST__: true,
    getSettings: () => ({
      pieceSet: "cburnett",
      sound: false,
      legalMoves: true,
    }),
    resolvePieceTheme: () => "pieces/cburnett/{piece}.svg",
  };
  context.window = context;

  vm.runInNewContext(read("puzzles-data.js"), context, { filename: "puzzles-data.js" });
  vm.runInNewContext(read("puzzles.js"), context, { filename: "puzzles.js" });
  await flush();
  await flush();

  const api = context.__faithChessPuzzleTest;
  let state = api.getState();
  assert.equal(boardConfigs[0].pieceTheme, "pieces/cburnett/{piece}.svg");
  assert.equal(state.fallbackCount, 7);
  assert.notEqual(state.puzzleId, null);
  assert.equal(state.loading, false);
  assert.equal(state.inputLocked, true, "input must stay locked before autoplay");
  assert.match(document.getElementById("puzzleDataStatus").textContent, /Offline puzzle pack active/);
  assert.equal(warnings.length >= 1, true);

  const sampledCsv = [
    "PuzzleId,FEN,Moves,Rating",
    "bounded,8/P7/8/8/8/8/6k1/4K3 b - - 0 1,g2f3 a7a8n,1200",
    "",
  ].join("\n");
  const bytes = new TextEncoder().encode(sampledCsv);
  let cancelled = 0;
  let request = null;
  let reads = 0;
  const boundedFetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 206,
      headers: {
        get(name) {
          const headers = {
            "content-length": String(bytes.byteLength),
            "content-range": `bytes 0-${bytes.byteLength - 1}/1084213690`,
            "content-type": "text/plain",
          };
          return headers[name.toLowerCase()] || null;
        },
      },
      body: {
        getReader() {
          return {
            async read() {
              if (reads++) return { done: true, value: undefined };
              return { done: false, value: bytes };
            },
            async cancel() {
              cancelled++;
            },
          };
        },
      },
    };
  };
  const sampled = await api.loadRemotePuzzleSample(boundedFetch);
  assert.equal(sampled.length, 1);
  assert.equal(
    request.url,
    "https://media.githubusercontent.com/media/veefs/chess-notes-/006c3249b387e72e5033ea9a20630dc7637934b2/lichess_db_puzzles.csv",
  );
  assert.equal(request.options.headers.Range, "bytes=0-262143");
  assert.equal(cancelled, 1);

  const invalidRangeResponse = ({
    status = 206,
    contentLength = String(bytes.byteLength),
    contentRange,
  }) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const headers = {
          "content-length": contentLength,
          "content-range": contentRange,
          "content-type": "text/plain",
        };
        return headers[name.toLowerCase()] ?? null;
      },
    },
    body: {
      getReader() {
        throw new Error("invalid range metadata must be rejected before reading");
      },
    },
  });

  for (const [description, response, message] of [
    [
      "missing Content-Range",
      invalidRangeResponse({ contentRange: null }),
      /missing Content-Range/i,
    ],
    [
      "malformed Content-Range",
      invalidRangeResponse({ contentRange: "bytes nope" }),
      /invalid Content-Range/i,
    ],
    [
      "non-zero Content-Range start",
      invalidRangeResponse({
        contentRange: `bytes 1-${bytes.byteLength}/${1084213690}`,
      }),
      /start at byte zero/i,
    ],
    [
      "Content-Range length mismatch",
      invalidRangeResponse({
        contentRange: `bytes 0-${bytes.byteLength}/${1084213690}`,
      }),
      /does not match Content-Length/i,
    ],
    [
      "Content-Range beyond requested budget",
      invalidRangeResponse({
        contentLength: String(api.REMOTE_PUZZLE_SOURCE.byteLimit + 1),
        contentRange: `bytes 0-${api.REMOTE_PUZZLE_SOURCE.byteLimit}/${1084213690}`,
      }),
      /byte budget/i,
    ],
    [
      "Content-Range with incoherent total",
      invalidRangeResponse({
        contentRange: `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength - 1}`,
      }),
      /invalid total length/i,
    ],
  ]) {
    await assert.rejects(
      api.loadRemotePuzzleSample(async () => response),
      message,
      description,
    );
  }

  await assert.rejects(
    api.loadRemotePuzzleSample(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: { getReader: () => { throw new Error("must not read full body"); } },
    })),
    /refused the required byte range/,
  );

  const underpromotion = {
    id: "underpromotion-regression",
    fen: "8/P7/8/8/8/8/6k1/4K3 b - - 0 1",
    solution: ["g2f3", "a7a8n"],
    rating: 1200,
  };
  api.loadPuzzle(underpromotion);
  assert.equal(api.getState().inputLocked, true);
  timers.runNext();
  state = api.getState();
  assert.equal(state.step, 1);
  assert.equal(state.inputLocked, false);

  moveLog.length = 0;
  api.onDrop("a7", "a8");
  state = api.getState();
  assert.equal(moveLog.at(-1).promotion, "n");
  assert.equal(state.step, 2);
  assert.equal(state.inputLocked, true);
  assert.equal(state.completionScheduled, true);
  assert.equal(api.onDrop("a7", "a8"), "snapback");
  assert.equal(api.promotionForUci("a7a8r"), "r");
  assert.equal(api.promotionForUci("a7a8b"), "b");
});

function createViewerContext(scriptName, grid = false) {
  const ids = grid
    ? [
        "board1", "board2", "board3", "board4",
        "board1-white", "board1-black", "board2-white", "board2-black",
        "board3-white", "board3-black", "board4-white", "board4-black",
      ]
    : ["board", "white-bar", "black-bar", "moves"];
  const document = makeDocument(ids);
  const boardConfigs = [];

  class ViewerChess {
    constructor() {
      this.reset();
    }

    reset() {
      this.movesPlayed = [];
    }

    move(san) {
      if (!san) return null;
      this.movesPlayed.push(san);
      return { from: "e2", to: "e4" };
    }

    fen() {
      return `fen-${this.movesPlayed.length}`;
    }
  }

  function Chessboard(id, config) {
    boardConfigs.push({ id, config });
    return { position() {} };
  }

  const warnings = [];
  const context = {
    window: null,
    document,
    Chess: ViewerChess,
    Chessboard,
    AbortController,
    console: {
      warn(...args) {
        warnings.push(args);
      },
    },
    setTimeout,
    clearTimeout,
    setInterval() {
      throw new Error("test mode must not schedule polling");
    },
    fetch: async () => {
      throw new Error("fetch mock not configured");
    },
    __FAITHCHESS_TEST__: true,
    getSettings: () => ({ pieceSet: "monarchy" }),
    resolvePieceTheme: () => "pieces/monarchy/{piece}.webp",
  };
  context.window = context;
  vm.runInNewContext(read(scriptName), context, { filename: scriptName });
  return { context, document, boardConfigs, warnings };
}

const maliciousPgn = [
  '[White "<img src=x onerror=alert(1)>"]',
  '[Black "Normal"]',
  '[WhiteTitle "GM"]',
  '[WhiteElo "2500"]',
  "",
  "1. e4 e5 *",
].join("\n");

await test("single live polling serializes queued refreshes and renders PGN tags as text", async () => {
  const { context, document, boardConfigs } = createViewerContext("live.js");
  const api = context.__faithChessLiveTest;
  assert.equal(boardConfigs[0].config.pieceTheme, "pieces/monarchy/{piece}.webp");

  api.parsePlayers(maliciousPgn);
  assert.equal(
    document.getElementById("white-bar").textContent,
    "GM <img src=x onerror=alert(1)> (2500)",
  );

  const firstChannels = deferred();
  let channelCalls = 0;
  const requests = [];
  context.fetch = async (url) => {
    requests.push(url);
    if (url.includes("/api/tv/channels")) {
      channelCalls++;
      if (channelCalls === 1) return firstChannels.promise;
      return responseJson({ bullet: { gameId: "newgame" } });
    }
    if (url.endsWith("/newgame")) return responseText(maliciousPgn);
    throw new Error(`unexpected URL ${url}`);
  };

  const drained = api.requestUpdate();
  api.requestUpdate();
  firstChannels.resolve(responseJson({ bullet: { gameId: "oldgame" } }));
  await drained;

  assert.equal(api.getState().lastGameId, "newgame");
  assert.deepEqual(
    requests.filter((url) => url.includes("/game/export/")).map((url) => url.split("/").at(-1)),
    ["oldgame", "newgame"],
  );
  assert.equal(api.getState().pendingRefreshes, 0);

  context.fetch = async () => responseJson({}, 503);
  await api.requestUpdate();
  assert.equal(api.getState().lastGameId, "newgame");
});

await test("watch grid starts PGN fetches in parallel and isolates failed boards", async () => {
  const { context, document, boardConfigs } = createViewerContext("grid.js", true);
  const api = context.__faithChessGridTest;
  assert.equal(boardConfigs.length, 4);
  assert.equal(
    boardConfigs.every(({ config }) => config.pieceTheme === "pieces/monarchy/{piece}.webp"),
    true,
  );

  const gameIds = ["bullet1", "blitz2", "rapid3", "classic4"];
  const pending = new Map();
  const started = [];
  context.fetch = async (url) => {
    if (url.includes("/api/tv/channels")) {
      return responseJson({
        bullet: { gameId: gameIds[0] },
        blitz: { gameId: gameIds[1] },
        rapid: { gameId: gameIds[2] },
        classical: { gameId: gameIds[3] },
      });
    }
    const item = deferred();
    const gameId = url.split("/").at(-1);
    pending.set(gameId, item);
    started.push(gameId);
    return item.promise;
  };

  const update = api.requestUpdate();
  await flush();
  await flush();
  assert.deepEqual(started.sort(), [...gameIds].sort(), "all PGNs must start before any resolves");

  pending.get("bullet1").resolve(responseText(maliciousPgn));
  pending.get("blitz2").resolve(responseText("", 503));
  pending.get("rapid3").resolve(responseText(maliciousPgn));
  pending.get("classic4").resolve(responseText(maliciousPgn));
  await update;

  const games = api.getState().games;
  assert.equal(games[0].gameId, "bullet1");
  assert.equal(games[1].gameId, null);
  assert.equal(games[2].gameId, "rapid3");
  assert.equal(games[3].gameId, "classic4");
  assert.equal(
    document.getElementById("board1-white").textContent,
    "GM <img src=x onerror=alert(1)> (2500)",
  );
});

await test("script ordering and source guards remain deployment-safe", () => {
  const watch = read("watch.html");
  assert.ok(
    watch.indexOf('<script src="settings.js"></script>')
      < watch.indexOf('<script src="grid.js"></script>'),
    "settings must load before watch boards",
  );

  const puzzles = read("puzzles.js");
  const puzzlesHtml = read("puzzles.html");
  assert.ok(
    puzzlesHtml.indexOf('<script src="puzzles-data.js"></script>')
      < puzzlesHtml.indexOf('<script src="puzzles.js"></script>'),
    "offline data must load before the puzzle runtime",
  );
  for (const id of ["puzzleRating", "puzzleStreak", "solutionMoves", "puzzleDataStatus", "retryPuzzleDataBtn"]) {
    assert.match(puzzlesHtml, new RegExp(`id="${id}"`));
  }
  assert.match(puzzles, /status !== 206/);
  assert.match(puzzles, /reader\.cancel/);
  assert.match(puzzles, /byteLimit: 256 \* 1024/);
  assert.doesNotMatch(puzzles, /refs\/heads\/main/);

  const live = read("live.js");
  const grid = read("grid.js");
  assert.doesNotMatch(live, /\.innerHTML\s*=/);
  assert.doesNotMatch(grid, /\.innerHTML\s*=/);
  assert.match(live, /if \(!response\.ok\)/);
  assert.match(grid, /if \(!response\.ok\)/);
  assert.match(grid, /Promise\.all\(gameIds\.map/);
});

console.log(`1..${passed}`);
