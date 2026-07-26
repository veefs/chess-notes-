"use strict";

const boardIds = ["board1", "board2", "board3", "board4"];
const gridSettings = window.getSettings ? window.getSettings() : {};
const gridPieceTheme = window.resolvePieceTheme
  ? window.resolvePieceTheme(gridSettings.pieceSet)
  : "pieces/cburnett/{piece}.svg";

const instances = boardIds.map((id) => ({
  id,
  board: Chessboard(id, {
    position: "start",
    draggable: false,
    pieceTheme: gridPieceTheme,
  }),
  game: new Chess(),
  lastMovesLength: 0,
  gameId: null,
}));

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

async function getTVGames() {
  const data = await fetchChecked("https://lichess.org/api/tv/channels", "json");
  return [
    data?.bullet?.gameId || null,
    data?.blitz?.gameId || null,
    data?.rapid?.gameId || null,
    data?.classical?.gameId || null,
  ];
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

function parsePlayers(pgn, prefix) {
  const whiteBar = document.getElementById(`${prefix}-white`);
  const blackBar = document.getElementById(`${prefix}-black`);
  if (whiteBar) whiteBar.textContent = formatPlayer(pgn, "White");
  if (blackBar) blackBar.textContent = formatPlayer(pgn, "Black");
}

function clearHighlights(boardId) {
  document
    .querySelectorAll(`#${boardId} .highlight-square`)
    .forEach((element) => element.classList.remove("highlight-square"));
}

function highlightSquare(boardId, square) {
  const element = document.querySelector(`#${boardId} .square-${square}`);
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

function applyMoves(instance, pgn) {
  const moves = parseMoveTokens(pgn);
  let appliedLength = instance.lastMovesLength;

  for (let index = instance.lastMovesLength; index < moves.length; index++) {
    const move = instance.game.move(moves[index]);
    if (!move) {
      console.warn("Lichess PGN contained an unapplied move; waiting for a fresh export.");
      break;
    }

    appliedLength = index + 1;
    instance.board.position(instance.game.fen());
    clearHighlights(instance.id);
    highlightSquare(instance.id, move.from);
    highlightSquare(instance.id, move.to);
  }

  instance.lastMovesLength = appliedLength;
}

async function performUpdate(generation) {
  try {
    const gameIds = await getTVGames();
    if (generation !== pollGeneration) return;

    const pgns = await Promise.all(gameIds.map(async (gameId) => {
      if (!gameId) return null;
      try {
        return await fetchPGN(gameId);
      } catch (error) {
        console.warn("One Lichess board could not refresh; its previous position was preserved.", error);
        return null;
      }
    }));
    if (generation !== pollGeneration) return;

    for (let index = 0; index < instances.length; index++) {
      const instance = instances[index];
      const gameId = gameIds[index];
      const pgn = pgns[index];
      if (!gameId || !pgn) continue;

      if (instance.gameId !== gameId) {
        instance.gameId = gameId;
        instance.game.reset();
        instance.board.position("start");
        instance.lastMovesLength = 0;
      }

      parsePlayers(pgn, instance.id);
      applyMoves(instance, pgn);
    }
  } catch (error) {
    if (generation === pollGeneration) {
      console.warn("Watch grid refresh failed; previous positions were preserved.", error);
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
  window.__faithChessGridTest = Object.freeze({
    parsePlayers,
    parseMoveTokens,
    requestUpdate,
    getState: () => ({
      pollGeneration,
      pendingRefreshes,
      pieceTheme: gridPieceTheme,
      games: instances.map((instance) => ({
        id: instance.id,
        gameId: instance.gameId,
        lastMovesLength: instance.lastMovesLength,
      })),
    }),
  });
}
