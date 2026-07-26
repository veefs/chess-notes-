"use strict";

const settings = window.getSettings ? window.getSettings() : {};
const pieceTheme = window.resolvePieceTheme
  ? window.resolvePieceTheme(settings.pieceSet)
  : "pieces/cburnett/{piece}.svg";

const REMOTE_PUZZLE_SOURCE = Object.freeze({
  revision: "006c3249b387e72e5033ea9a20630dc7637934b2",
  url: "https://media.githubusercontent.com/media/veefs/chess-notes-/006c3249b387e72e5033ea9a20630dc7637934b2/lichess_db_puzzles.csv",
  byteLimit: 256 * 1024,
  rowLimit: 240,
  timeoutMs: 6000,
});

let puzzle = null;
let step = 0;
let streak = 0;
let inputLocked = true;
let loading = false;
let puzzlePool = [];
let fallbackPuzzles = [];
let autoRunning = false;
let playerColor = "white";
let solutionPlaying = false;
let completionScheduled = false;
let puzzleGeneration = 0;
let remoteLoadPromise = null;
let remoteLoaded = false;
const puzzleTimers = new Set();

const game = new Chess();
let board = Chessboard("board", {
  draggable: true,
  moveSpeed: 200,
  snapSpeed: 150,
  snapbackSpeed: 200,
  position: "start",
  pieceTheme,
  onDrop,
  onDragStart,
  onSnapbackEnd: () => clearLegalDots(),
});

const UI = {
  side: () => document.getElementById("sideToMove"),
  rating: () => document.getElementById("puzzleRating"),
  streak: () => document.getElementById("puzzleStreak"),
  solution: () => document.getElementById("solutionMoves"),
  dataStatus: () => document.getElementById("puzzleDataStatus"),
  retryData: () => document.getElementById("retryPuzzleDataBtn"),
};

const popup = document.getElementById("puzzle-popup");
const retryBtn = document.getElementById("retryBtn");
const exitBtn = document.getElementById("exitBtn");
const viewSolutionBtn = document.getElementById("viewSolutionBtn");
const retryDataBtn = UI.retryData();

const sounds = {
  move: new Audio("sounds/move-self.mp3"),
  capture: new Audio("sounds/capture.mp3"),
  check: new Audio("sounds/move-check.mp3"),
  correct: new Audio("sounds/shoutout.mp3"),
  incorrect: new Audio("sounds/puzzle-wrong.mp3"),
};

function playSound(name) {
  const latestSettings = window.getSettings ? window.getSettings() : settings;
  if (!latestSettings.sound) return;

  const sound = sounds[name];
  if (!sound) return;
  sound.currentTime = 0;
  sound.play().catch(() => {
    // Audio is optional and may be blocked until the first user gesture.
  });
}

function setDataStatus(message, canRetry = false) {
  const status = UI.dataStatus();
  if (status) status.textContent = message;
  const retry = UI.retryData();
  if (retry) retry.classList.toggle("hidden", !canRetry);
}

function updateUI() {
  if (!puzzle) return;

  const side = UI.side();
  const rating = UI.rating();
  const streakEl = UI.streak();

  if (side) side.textContent = playerColor === "white" ? "White" : "Black";
  if (rating) rating.textContent = String(puzzle.rating ?? "-");
  if (streakEl) streakEl.textContent = String(streak);
}

function resetPopupCopy() {
  if (!popup) return;
  const title = popup.querySelector("#puzzle-title");
  const description = popup.querySelector("#puzzle-desc");
  if (title) title.textContent = "❌ Wrong Move";
  if (description) description.textContent = "That move doesn't solve the puzzle.";
}

function splitCSVLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  fields.push(current);
  return fields;
}

function promotionForUci(uci) {
  const promotion = typeof uci === "string" ? uci[4] : "";
  return /^[qrbn]$/.test(promotion) ? promotion : "q";
}

function normalizePuzzle(candidate) {
  if (!candidate || typeof candidate !== "object") return null;

  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const fen = typeof candidate.fen === "string" ? candidate.fen.trim() : "";
  const rawSolution = Array.isArray(candidate.solution)
    ? candidate.solution
    : typeof candidate.solution === "string"
      ? candidate.solution.trim().split(/\s+/)
      : [];
  const solution = rawSolution.map((move) => String(move).trim().toLowerCase());
  const rating = Number(candidate.rating);

  if (!id || id.length > 80 || !fen || fen.length > 160) return null;
  if (solution.length < 2 || solution.length > 32) return null;
  if (!solution.every((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move))) {
    return null;
  }
  if (!Number.isInteger(rating) || rating < 0 || rating > 4000) return null;

  try {
    const validator = new Chess();
    if (!validator.load(fen)) return null;

    for (const uci of solution) {
      const move = validator.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: promotionForUci(uci),
      });
      if (!move) return null;
    }
  } catch (error) {
    return null;
  }

  return Object.freeze({
    id,
    fen,
    solution: Object.freeze(solution),
    rating,
  });
}

function parsePuzzleCSV(text, rowLimit = REMOTE_PUZZLE_SOURCE.rowLimit) {
  if (typeof text !== "string" || !text.trim()) return [];

  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const header = splitCSVLine(lines.shift() || "");
  if (
    header[0] !== "PuzzleId"
    || header[1] !== "FEN"
    || header[2] !== "Moves"
    || header[3] !== "Rating"
  ) {
    throw new Error("Puzzle sample has an unexpected CSV header.");
  }

  const parsed = [];
  const seen = new Set();
  for (const line of lines) {
    if (parsed.length >= rowLimit) break;
    if (!line.trim()) continue;
    const fields = splitCSVLine(line);
    if (fields.length < 4) continue;

    const normalized = normalizePuzzle({
      id: fields[0],
      fen: fields[1],
      solution: fields[2],
      rating: Number.parseInt(fields[3], 10),
    });
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    parsed.push(normalized);
  }

  return parsed;
}

function shuffled(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function prepareFallbackPuzzles() {
  const candidates = window.FAITHCHESS_PUZZLE_DATA?.puzzles;
  fallbackPuzzles = Array.isArray(candidates)
    ? candidates.map(normalizePuzzle).filter(Boolean)
    : [];

  puzzlePool = shuffled(fallbackPuzzles);
  if (fallbackPuzzles.length) {
    setDataStatus(`Offline puzzle pack ready · ${fallbackPuzzles.length} puzzles`);
  } else {
    setDataStatus("Offline puzzle pack is unavailable.", true);
  }
}

function refillFallbackPool() {
  if (!puzzlePool.length && fallbackPuzzles.length) {
    puzzlePool = shuffled(fallbackPuzzles);
  }
}

async function readBoundedPuzzleResponse(response) {
  if (!response.ok) {
    throw new Error(`Puzzle source returned HTTP ${response.status}.`);
  }
  if (response.status !== 206) {
    throw new Error("Puzzle source refused the required byte range.");
  }

  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = Number(contentLengthHeader);
  if (
    !/^\d+$/.test(contentLengthHeader || "")
    || !Number.isFinite(contentLength)
    || !Number.isSafeInteger(contentLength)
    || contentLength <= 0
  ) {
    throw new Error("Puzzle source returned an invalid Content-Length.");
  }

  const contentRangeHeader = response.headers.get("content-range");
  if (!contentRangeHeader) {
    throw new Error("Puzzle source is missing Content-Range metadata.");
  }
  const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
    contentRangeHeader.trim(),
  );
  if (!contentRange) {
    throw new Error("Puzzle source returned an invalid Content-Range.");
  }

  const rangeStart = Number(contentRange[1]);
  const rangeEnd = Number(contentRange[2]);
  const totalLength = Number(contentRange[3]);
  if (
    !Number.isSafeInteger(rangeStart)
    || !Number.isSafeInteger(rangeEnd)
    || !Number.isSafeInteger(totalLength)
    || rangeEnd < rangeStart
  ) {
    throw new Error("Puzzle source returned an invalid Content-Range.");
  }
  if (rangeStart !== 0) {
    throw new Error("Puzzle source range must start at byte zero.");
  }
  if (rangeEnd - rangeStart + 1 !== contentLength) {
    throw new Error("Puzzle source Content-Range does not match Content-Length.");
  }
  if (
    contentLength > REMOTE_PUZZLE_SOURCE.byteLimit
    || rangeEnd >= REMOTE_PUZZLE_SOURCE.byteLimit
  ) {
    throw new Error("Puzzle sample exceeded its byte budget.");
  }
  if (totalLength <= rangeEnd) {
    throw new Error("Puzzle source returned an invalid total length.");
  }

  const contentType = response.headers.get("content-type") || "";
  if (
    contentType
    && !/^text\/(?:plain|csv)\b/i.test(contentType)
    && !/^application\/octet-stream\b/i.test(contentType)
  ) {
    throw new Error("Puzzle source returned an unsupported content type.");
  }
  if (!response.body?.getReader) {
    throw new Error("Puzzle source did not provide a readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  let ended = false;

  try {
    while (bytesRead < REMOTE_PUZZLE_SOURCE.byteLimit) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      if (!(value instanceof Uint8Array)) {
        throw new Error("Puzzle source returned an invalid data chunk.");
      }

      const remaining = REMOTE_PUZZLE_SOURCE.byteLimit - bytesRead;
      const boundedChunk = value.byteLength > remaining
        ? value.subarray(0, remaining)
        : value;
      bytesRead += boundedChunk.byteLength;
      text += decoder.decode(boundedChunk, { stream: true });

      if (boundedChunk.byteLength !== value.byteLength) break;
      if ((text.match(/\n/g) || []).length > REMOTE_PUZZLE_SOURCE.rowLimit + 1) {
        break;
      }
    }
    text += decoder.decode();
  } finally {
    try {
      await reader.cancel("Bounded puzzle sample complete.");
    } catch (error) {
      // The reader can already be closed after a short test fixture.
    }
  }

  if (!ended && !text.endsWith("\n")) {
    text = text.slice(0, Math.max(0, text.lastIndexOf("\n") + 1));
  }
  return text;
}

async function loadRemotePuzzleSample(fetchImpl = window.fetch.bind(window)) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_PUZZLE_SOURCE.timeoutMs);

  try {
    const response = await fetchImpl(REMOTE_PUZZLE_SOURCE.url, {
      method: "GET",
      headers: {
        Range: `bytes=0-${REMOTE_PUZZLE_SOURCE.byteLimit - 1}`,
      },
      cache: "no-store",
      signal: controller.signal,
    });
    const text = await readBoundedPuzzleResponse(response);
    const parsed = parsePuzzleCSV(text, REMOTE_PUZZLE_SOURCE.rowLimit);
    if (!parsed.length) {
      throw new Error("Puzzle sample did not contain any valid rows.");
    }
    return parsed;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function refreshRemotePuzzles({ force = false, fetchImpl } = {}) {
  if (remoteLoadPromise) return remoteLoadPromise;
  if (remoteLoaded && !force) return [];

  setDataStatus(
    `Offline puzzle pack active · checking bounded historical sample…`,
    false,
  );

  remoteLoadPromise = (async () => {
    try {
      const remotePuzzles = await loadRemotePuzzleSample(fetchImpl);
      const knownIds = new Set([
        ...fallbackPuzzles.map((item) => item.id),
        ...puzzlePool.map((item) => item.id),
      ]);
      const additions = remotePuzzles.filter((item) => !knownIds.has(item.id));
      puzzlePool.push(...shuffled(additions));
      remoteLoaded = true;
      setDataStatus(
        additions.length
          ? `Offline pack ready · ${additions.length} bounded online puzzles added`
          : "Offline puzzle pack ready · historical sample already cached locally",
        false,
      );
      return additions;
    } catch (error) {
      remoteLoaded = false;
      console.warn("Bounded online puzzle sample was unavailable; using offline pack.", error);
      setDataStatus("Offline puzzle pack active · online sample unavailable", true);
      return [];
    } finally {
      remoteLoadPromise = null;
    }
  })();

  return remoteLoadPromise;
}

function fetchPuzzle() {
  refillFallbackPool();
  return puzzlePool.pop() || null;
}

function clearHighlights() {
  document
    .querySelectorAll(".highlight-green, .highlight-red, .highlight-blue")
    .forEach((element) => {
      element.classList.remove("highlight-green", "highlight-red", "highlight-blue");
    });
}

function highlightSquare(square, type) {
  const element = document.querySelector(`.square-${square}`);
  if (!element) return;
  if (type === "green") element.classList.add("highlight-green");
  else if (type === "red") element.classList.add("highlight-red");
  else if (type === "blue") element.classList.add("highlight-blue");
}

function clearLegalDots() {
  document.querySelectorAll(".legal-dot, .legal-dot-capture").forEach((element) => {
    element.classList.remove("legal-dot", "legal-dot-capture");
  });
}

function buildSolutionNotation(startFen, moves) {
  const temp = new Chess();
  if (!temp.load(startFen)) return [];

  const notations = [];
  for (const uci of moves) {
    const move = temp.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: promotionForUci(uci),
    });
    if (!move) break;
    notations.push(move.san);
  }
  return notations;
}

function clearPuzzleTimers() {
  for (const timer of puzzleTimers) clearTimeout(timer);
  puzzleTimers.clear();
}

function nextPuzzleGeneration() {
  clearPuzzleTimers();
  puzzleGeneration++;
  return puzzleGeneration;
}

function scheduleForPuzzle(callback, delay, generation = puzzleGeneration) {
  const timer = setTimeout(() => {
    puzzleTimers.delete(timer);
    if (generation !== puzzleGeneration) return;
    callback();
  }, delay);
  puzzleTimers.add(timer);
  return timer;
}

function finishPuzzle(generation = puzzleGeneration) {
  if (generation !== puzzleGeneration || completionScheduled) return;
  completionScheduled = true;
  inputLocked = true;
  playSound("correct");

  scheduleForPuzzle(() => {
    streak++;
    updateUI();
    start();
  }, 1000, generation);
}

function runAutoSequence(generation = puzzleGeneration) {
  if (
    generation !== puzzleGeneration
    || !puzzle
    || autoRunning
    || completionScheduled
  ) {
    return;
  }
  if (step >= puzzle.solution.length) {
    finishPuzzle(generation);
    return;
  }

  inputLocked = true;
  autoRunning = true;
  const uci = puzzle.solution[step];

  try {
    const move = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: promotionForUci(uci),
    });
    if (!move) {
      throw new Error(`Validated puzzle ${puzzle.id} became illegal at step ${step}.`);
    }

    board.position(game.fen(), true);
    clearHighlights();
    highlightSquare(uci.slice(0, 2), "blue");
    highlightSquare(uci.slice(2, 4), "blue");
    step++;

    if (step >= puzzle.solution.length) finishPuzzle(generation);
    else inputLocked = false;
  } catch (error) {
    inputLocked = true;
    console.error("Puzzle autoplay stopped safely.", error);
    setDataStatus("This puzzle could not continue. Try another puzzle.", true);
  } finally {
    autoRunning = false;
  }
}

function onDragStart(source) {
  if (
    inputLocked
    || autoRunning
    || completionScheduled
    || !puzzle
    || step >= puzzle.solution.length
  ) {
    return false;
  }

  const latestSettings = window.getSettings ? window.getSettings() : settings;
  if (latestSettings.legalMoves) {
    clearLegalDots();
    const moves = game.moves({ square: source, verbose: true });
    moves.forEach((move) => {
      const element = document.querySelector(`.square-${move.to}`);
      if (!element) return;
      element.classList.add(move.captured ? "legal-dot-capture" : "legal-dot");
    });
  }
  return true;
}

function onDrop(source, target) {
  clearLegalDots();
  if (
    inputLocked
    || autoRunning
    || completionScheduled
    || !puzzle
    || step >= puzzle.solution.length
  ) {
    return "snapback";
  }

  const expected = puzzle.solution[step];
  if (!expected) return "snapback";

  const expectedFrom = expected.slice(0, 2);
  const expectedTo = expected.slice(2, 4);
  const move = game.move({
    from: source,
    to: target,
    promotion: promotionForUci(expected),
  });
  if (!move) return "snapback";

  let soundType = "move";
  if (move.captured) soundType = "capture";
  if (game.in_check()) soundType = "check";
  playSound(soundType);

  if (source !== expectedFrom || target !== expectedTo) {
    clearHighlights();
    highlightSquare(target, "red");
    playSound("incorrect");
    inputLocked = true;
    streak = 0;
    resetPopupCopy();
    popup?.classList.remove("hidden");
    updateUI();
    return;
  }

  clearHighlights();
  highlightSquare(source, "green");
  highlightSquare(target, "green");
  step++;

  if (step >= puzzle.solution.length) {
    finishPuzzle();
  } else {
    inputLocked = true;
    scheduleForPuzzle(() => runAutoSequence(), 300);
  }
}

function loadPuzzle(candidate) {
  const normalized = normalizePuzzle(candidate);
  if (!normalized) throw new Error("Cannot load an invalid puzzle.");

  const generation = nextPuzzleGeneration();
  puzzle = normalized;
  step = 0;
  inputLocked = true;
  autoRunning = false;
  solutionPlaying = false;
  completionScheduled = false;
  resetPopupCopy();

  const tempGame = new Chess();
  tempGame.load(puzzle.fen);
  playerColor = tempGame.turn() === "w" ? "black" : "white";

  game.load(puzzle.fen);
  board.orientation(playerColor);
  board.position(puzzle.fen, false);
  clearHighlights();
  clearLegalDots();

  const solution = UI.solution();
  if (solution) {
    solution.textContent = "";
    solution.closest(".panel-row")?.classList.add("hidden");
  }

  updateUI();
  scheduleForPuzzle(() => runAutoSequence(generation), 200, generation);
}

function playSolution() {
  if (!puzzle || solutionPlaying) return;

  const generation = nextPuzzleGeneration();
  solutionPlaying = true;
  inputLocked = true;
  completionScheduled = false;
  popup?.classList.add("hidden");

  game.load(puzzle.fen);
  board.position(puzzle.fen, false);
  clearHighlights();
  clearLegalDots();

  const notations = buildSolutionNotation(puzzle.fen, puzzle.solution);
  const solution = UI.solution();
  if (solution) {
    solution.textContent = notations.join(", ");
    solution.closest(".panel-row")?.classList.remove("hidden");
  }

  const tempGame = new Chess();
  tempGame.load(puzzle.fen);
  let index = 0;

  function playNext() {
    if (generation !== puzzleGeneration) return;
    if (index >= puzzle.solution.length) {
      solutionPlaying = false;
      inputLocked = true;
      popup?.classList.remove("hidden");
      const title = popup?.querySelector("#puzzle-title");
      const description = popup?.querySelector("#puzzle-desc");
      if (title) title.textContent = "Solution complete!";
      if (description) {
        description.textContent = "Try the puzzle again or move to the next one.";
      }
      return;
    }

    const uci = puzzle.solution[index];
    const move = tempGame.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: promotionForUci(uci),
    });
    if (!move) {
      solutionPlaying = false;
      inputLocked = true;
      setDataStatus("The solution could not be replayed.", true);
      return;
    }

    board.position(tempGame.fen(), true);
    clearHighlights();
    const color = index % 2 === 0 ? "blue" : "green";
    highlightSquare(uci.slice(0, 2), color);
    highlightSquare(uci.slice(2, 4), color);
    playSound(move.captured ? "capture" : "move");
    index++;
    scheduleForPuzzle(playNext, 800, generation);
  }

  playNext();
}

async function start() {
  if (loading) return;
  loading = true;
  inputLocked = true;

  try {
    const nextPuzzle = fetchPuzzle();
    if (!nextPuzzle) {
      throw new Error("No validated offline puzzle is available.");
    }
    loadPuzzle(nextPuzzle);
  } catch (error) {
    console.error("Puzzle loading failed safely.", error);
    setDataStatus("No puzzle is available. Retry the online sample.", true);
  } finally {
    loading = false;
  }
}

retryBtn?.addEventListener("click", () => {
  popup?.classList.add("hidden");
  if (puzzle) loadPuzzle(puzzle);
});

exitBtn?.addEventListener("click", () => {
  popup?.classList.add("hidden");
  streak = 0;
  start();
});

viewSolutionBtn?.addEventListener("click", playSolution);

retryDataBtn?.addEventListener("click", () => {
  void refreshRemotePuzzles({ force: true });
  if (!puzzle && !loading) void start();
});

prepareFallbackPuzzles();
void start();
void refreshRemotePuzzles();

if (window.__FAITHCHESS_TEST__) {
  window.__faithChessPuzzleTest = Object.freeze({
    REMOTE_PUZZLE_SOURCE,
    splitCSVLine,
    promotionForUci,
    normalizePuzzle,
    parsePuzzleCSV,
    loadRemotePuzzleSample,
    refreshRemotePuzzles,
    loadPuzzle,
    runAutoSequence,
    onDrop,
    getState: () => ({
      puzzleId: puzzle?.id || null,
      step,
      inputLocked,
      loading,
      autoRunning,
      completionScheduled,
      fallbackCount: fallbackPuzzles.length,
      poolCount: puzzlePool.length,
      remoteLoaded,
      generation: puzzleGeneration,
    }),
  });
}
