"use strict";

const boardEl = document.getElementById("board");
if (!boardEl) {
  throw new Error("No #board element found");
}

const liveSettings = window.getSettings ? window.getSettings() : {};
const livePieceTheme = window.resolvePieceTheme
  ? window.resolvePieceTheme(liveSettings.pieceSet)
  : "pieces/cburnett/{piece}.svg";

const game = new Chess();
const board = Chessboard("board", {
  position: "start",
  draggable: false,
  pieceTheme: livePieceTheme,
});

const movesEl = document.getElementById("moves");
let lastGameId = "";
let lastMovesLength = 0;
let pollGeneration = 0;
let pendingRefreshes = 0;
let pollLoopPromise = null;
const REQUEST_TIMEOUT_MS = 8000;

async function fetchChecked(url, responseType) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: responseType === "text"
        ? { Accept: "application/x-chess-pgn, text/plain;q=0.9" }
        : { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Lichess returned HTTP ${response.status}.`);
    }
    return responseType === "text" ? await response.text() : await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getTVGameId() {
  const data = await fetchChecked("https://lichess.org/api/tv/channels", "json");
  const gameId = data?.bullet?.gameId;
  return typeof gameId === "string" && gameId ? gameId : null;
}

async function fetchPGN(gameId) {
  return fetchChecked(
    `https://lichess.org/game/export/${encodeURIComponent(gameId)}`,
    "text",
  );
}

function readPgnTag(pgn, tag) {
  const match = pgn.match(new RegExp(`^\\[${tag} "([^"]*)"\\]\\r?$`, "m"));
  return match ? match[1].slice(0, 80) : "";
}

function formatPlayer(pgn, color) {
  const name = readPgnTag(pgn, color) || color;
  const title = readPgnTag(pgn, `${color}Title`);
  const rating = readPgnTag(pgn, `${color}Elo`);
  return [title, name, rating ? `(${rating})` : ""].filter(Boolean).join(" ");
}

function parsePlayers(pgn) {
  const whiteBar = document.getElementById("white-bar");
  const blackBar = document.getElementById("black-bar");
  if (whiteBar) whiteBar.textContent = formatPlayer(pgn, "White");
  if (blackBar) blackBar.textContent = formatPlayer(pgn, "Black");
}

function clearHighlights() {
  document
    .querySelectorAll(".highlight-square")
    .forEach((element) => element.classList.remove("highlight-square"));
}

function highlightSquare(square) {
  const element = document.querySelector(`.square-${square}`);
  if (element) element.classList.add("highlight-square");
}

function parseMoveTokens(pgn) {
  const moveText = pgn.split(/\r?\n\r?\n/).slice(1).join(" ");
  if (!moveText) return [];

  return moveText
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\d+\.(?:\.\.)?/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !/^(?:1-0|0-1|1\/2-1\/2|\*)$/.test(token));
}

function applyMoves(pgn) {
  const moves = parseMoveTokens(pgn);
  let appliedLength = lastMovesLength;

  for (let index = lastMovesLength; index < moves.length; index++) {
    const move = game.move(moves[index]);
    if (!move) {
      console.warn("Lichess PGN contained an unapplied move; waiting for a fresh export.");
      break;
    }

    appliedLength = index + 1;
    board.position(game.fen());
    clearHighlights();
    highlightSquare(move.from);
    highlightSquare(move.to);
  }

  lastMovesLength = appliedLength;
  if (movesEl) movesEl.textContent = moves.join(" ");
}

async function performUpdate(generation) {
  try {
    const gameId = await getTVGameId();
    if (generation !== pollGeneration || !gameId) return;

    const pgn = await fetchPGN(gameId);
    if (generation !== pollGeneration || !pgn) return;

    if (gameId !== lastGameId) {
      lastGameId = gameId;
      game.reset();
      board.position("start");
      lastMovesLength = 0;
    }

    parsePlayers(pgn);
    applyMoves(pgn);
  } catch (error) {
    if (generation === pollGeneration) {
      console.warn("Live board refresh failed; the previous position was preserved.", error);
    }
  }
}

async function drainUpdates() {
  try {
    while (pendingRefreshes > 0) {
      pendingRefreshes = 0;
      const generation = ++pollGeneration;
      await performUpdate(generation);
    }
  } finally {
    pollLoopPromise = null;
  }
}

function requestUpdate() {
  pendingRefreshes++;
  if (!pollLoopPromise) pollLoopPromise = drainUpdates();
  return pollLoopPromise;
}

if (!window.__FAITHCHESS_TEST__) {
  void requestUpdate();
  setInterval(() => {
    void requestUpdate();
  }, 3000);
}

if (window.__FAITHCHESS_TEST__) {
  window.__faithChessLiveTest = Object.freeze({
    parsePlayers,
    parseMoveTokens,
    requestUpdate,
    getState: () => ({
      lastGameId,
      lastMovesLength,
      pollGeneration,
      pendingRefreshes,
      pieceTheme: livePieceTheme,
    }),
  });
}
