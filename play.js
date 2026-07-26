const settings = window.getSettings ? window.getSettings() : {};
const pieceSet = settings.pieceSet || "cburnett";
const pieceTheme = resolveLocalPieceTheme(pieceSet);

// =======================
// TIME CONTROLS
// =======================
const TIME_CONTROLS = {
  bullet: { label: "Bullet", seconds: 60 },
  blitz: { label: "Blitz", seconds: 300 },
  rapid: { label: "Rapid", seconds: 600 },
};

const FIREBASE_READY_TIMEOUT_MS = 8000;
const FIREBASE_POLL_INTERVAL_MS = 50;
const FINISH_REASONS = new Set([
  "checkmate",
  "timeout",
  "stalemate",
  "repetition",
  "insufficient",
  "drawRule",
  "draw",
  "resign",
]);
const DRAW_REASONS = new Set([
  "stalemate",
  "repetition",
  "insufficient",
  "drawRule",
  "draw",
]);

function normalizeDisplayName(value, fallback) {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 80) : fallback;
}

function resolveLocalPieceTheme(selectedPieceSet) {
  const fallback = "pieces/cburnett/{piece}.svg";
  try {
    const candidate = typeof window.resolvePieceTheme === "function"
      ? window.resolvePieceTheme(selectedPieceSet)
      : fallback;
    if (typeof candidate !== "string" || !candidate.includes("{piece}")) {
      return fallback;
    }

    const base = new URL(window.location.href);
    const parsed = new URL(candidate, base);
    if (parsed.origin !== base.origin ||
        !["https:", "http:"].includes(parsed.protocol)) {
      return fallback;
    }
    return candidate;
  } catch {
    return fallback;
  }
}

function normalizeFirebaseKey(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized !== value ||
      !normalized ||
      normalized.length > 160 ||
      /[.#$[\]/\u0000-\u001F\u007F]/.test(normalized) ||
      ["__proto__", "constructor", "prototype"].includes(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeTimeControl(value) {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(TIME_CONTROLS, value)
    ? value
    : null;
}

function safeAvatarUrl(value, baseHref = window.location.href) {
  if (typeof value !== "string" || value.length > 2048) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  try {
    const base = new URL(baseHref);
    const parsed = new URL(normalized, base);
    const isLoopback = hostname =>
      ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    const sameOrigin = parsed.origin === base.origin;
    const trustedSameOrigin = sameOrigin && (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && isLoopback(parsed.hostname))
    );
    const trustedCloudinary = parsed.protocol === "https:" &&
      parsed.hostname === "res.cloudinary.com" &&
      !parsed.port;

    if ((!trustedSameOrigin && !trustedCloudinary) ||
        parsed.username ||
        parsed.password) {
      return null;
    }

    return parsed.href;
  } catch {
    return null;
  }
}

function normalizeMoves(moves) {
  if (!moves) return [];
  const values = Array.isArray(moves) ? moves : Object.values(moves);
  return values.filter(move => typeof move === "string");
}

function sameMoves(left, right) {
  return left.length === right.length &&
    left.every((move, index) => move === right[index]);
}

function oppositeColor(color) {
  return color === "white" ? "black" : "white";
}

function resolveTournamentContext(urlTournamentId, gameData) {
  if (gameData && typeof gameData === "object") {
    return normalizeFirebaseKey(gameData.tournamentId);
  }
  return normalizeFirebaseKey(urlTournamentId);
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resultForColor(data, color) {
  if (!data || data.status !== "finished" ||
      (color !== "white" && color !== "black")) {
    return null;
  }

  const declaredWinner = data.winner;
  if (declaredWinner != null &&
      declaredWinner !== "white" &&
      declaredWinner !== "black") {
    return null;
  }

  let resultWinner = null;
  if (data.result === "1-0") resultWinner = "white";
  else if (data.result === "0-1") resultWinner = "black";
  else if (data.result !== "1/2-1/2" && data.result != null) return null;

  if (declaredWinner && data.result != null &&
      declaredWinner !== resultWinner) {
    return null;
  }

  let winner = declaredWinner || resultWinner;
  if (!winner && data.result == null) {
    if (data.resigned === "white" || data.resigned === "black") {
      winner = oppositeColor(data.resigned);
    } else if (!DRAW_REASONS.has(data.finishReason) && !data.drawAccepted) {
      return null;
    }
  }
  if (!winner) return "draw";
  return winner === color ? "win" : "loss";
}

function resultClaimMatches(stored, expected) {
  return isRecord(stored) &&
    stored.gameId === expected.gameId &&
    stored.result === expected.result &&
    stored.myColor === expected.myColor &&
    stored.opponentUid === expected.opponentUid &&
    (stored.tournamentId || null) === (expected.tournamentId || null);
}

function historyEntryMatches(entry, expected) {
  return isRecord(entry) &&
    entry.gameId === expected.gameId &&
    entry.result === expected.result &&
    entry.myColor === expected.myColor;
}

function resultClaimMarker(claim, overrides = {}) {
  return {
    gameId: claim.gameId,
    result: claim.result,
    myColor: claim.myColor,
    opponentUid: claim.opponentUid,
    tournamentId: claim.tournamentId || null,
    appliedAt: claim.playedAt,
    tournamentEligible: true,
    version: 1,
    ...overrides,
  };
}

function applyUserGameResult(user, claim) {
  if (!isRecord(user) ||
      !normalizeFirebaseKey(claim?.gameId) ||
      !normalizeFirebaseKey(claim?.opponentUid) ||
      (claim?.tournamentId != null &&
        !normalizeFirebaseKey(claim?.tournamentId)) ||
      !["win", "loss", "draw"].includes(claim?.result) ||
      !["white", "black"].includes(claim?.myColor) ||
      !Number.isFinite(claim?.playedAt) ||
      claim.playedAt < 0 ||
      !Number.isInteger(claim?.moveCount) ||
      claim.moveCount < 0 ||
      !normalizeTimeControl(claim?.timeControl)) {
    return undefined;
  }

  const claims = isRecord(user.resultClaims) ? user.resultClaims : {};
  const history = isRecord(user.gameHistory) ? user.gameHistory : {};
  const existingClaim = claims[claim.gameId];

  if (existingClaim) {
    if (!resultClaimMatches(existingClaim, claim)) return undefined;
    if (user.currentGame !== claim.gameId) return undefined;
    return {
      ...user,
      currentGame: null,
    };
  }

  const legacyHistoryEntry = Object.values(history)
    .find(entry => isRecord(entry) && entry.gameId === claim.gameId);
  if (legacyHistoryEntry) {
    if (!historyEntryMatches(legacyHistoryEntry, claim)) return undefined;
    const playedAt = Number.isFinite(legacyHistoryEntry.playedAt)
      ? legacyHistoryEntry.playedAt
      : claim.playedAt;
    return {
      ...user,
      currentGame: user.currentGame === claim.gameId ? null : user.currentGame,
      resultClaims: {
        ...claims,
        [claim.gameId]: resultClaimMarker(claim, {
          appliedAt: playedAt,
          legacyHistory: true,
          // Older clients had no tournament marker. Re-applying a score here
          // could double-count it, so legacy results intentionally fail closed.
          tournamentEligible: false,
        }),
      },
    };
  }

  if (Object.prototype.hasOwnProperty.call(history, claim.gameId)) {
    return undefined;
  }

  const statsField = claim.result === "win"
    ? "wins"
    : claim.result === "loss"
      ? "losses"
      : "draws";
  if ((user[statsField] !== undefined && !Number.isFinite(user[statsField])) ||
      (user.rating !== undefined && !Number.isFinite(user.rating))) {
    return undefined;
  }
  const currentStat = user[statsField] === undefined
    ? 0
    : Math.max(0, Math.floor(user[statsField]));
  const currentRating = user.rating === undefined ? 800 : user.rating;
  const ratingChange = claim.result === "win"
    ? 10
    : claim.result === "loss"
      ? -10
      : 0;

  return {
    ...user,
    [statsField]: currentStat + 1,
    rating: Math.max(100, currentRating + ratingChange),
    currentGame: user.currentGame === claim.gameId ? null : user.currentGame,
    gameHistory: {
      ...history,
      [claim.gameId]: {
        gameId: claim.gameId,
        result: claim.result,
        opponentUsername: claim.opponentUsername,
        myColor: claim.myColor,
        moveCount: claim.moveCount,
        playedAt: claim.playedAt,
        ratingChange,
        timeControl: claim.timeControl,
      },
    },
    resultClaims: {
      ...claims,
      [claim.gameId]: resultClaimMarker(claim),
    },
  };
}

function tournamentResultClaimMatches(stored, expected) {
  return isRecord(stored) &&
    stored.gameId === expected.gameId &&
    stored.result === expected.result;
}

function applyTournamentGameResult(player, claim) {
  if (!isRecord(player) ||
      !normalizeFirebaseKey(claim?.gameId) ||
      !["win", "loss", "draw"].includes(claim?.result) ||
      !Number.isFinite(claim?.appliedAt) ||
      claim.appliedAt < 0) {
    return undefined;
  }

  const claims = isRecord(player.resultClaims) ? player.resultClaims : {};
  const existingClaim = claims[claim.gameId];
  if (existingClaim) return undefined;

  const counterFields = ["score", "wins", "draws", "losses", "gamesPlayed"];
  if (counterFields.some(field =>
    player[field] !== undefined && !Number.isFinite(player[field])
  )) {
    return undefined;
  }
  const scoreGain = claim.result === "win" ? 2 : claim.result === "draw" ? 1 : 0;
  return {
    ...player,
    score: (Number.isFinite(player.score) ? player.score : 0) + scoreGain,
    wins: (Number.isFinite(player.wins) ? player.wins : 0) +
      (claim.result === "win" ? 1 : 0),
    draws: (Number.isFinite(player.draws) ? player.draws : 0) +
      (claim.result === "draw" ? 1 : 0),
    losses: (Number.isFinite(player.losses) ? player.losses : 0) +
      (claim.result === "loss" ? 1 : 0),
    gamesPlayed: (Number.isFinite(player.gamesPlayed) ? player.gamesPlayed : 0) + 1,
    resultClaims: {
      ...claims,
      [claim.gameId]: {
        gameId: claim.gameId,
        result: claim.result,
        appliedAt: claim.appliedAt,
        version: 1,
      },
    },
  };
}

function getGameOverReason(chessGame) {
  if (chessGame.in_checkmate()) return "checkmate";
  if (typeof chessGame.in_stalemate === "function" && chessGame.in_stalemate()) {
    return "stalemate";
  }
  if (typeof chessGame.insufficient_material === "function" &&
      chessGame.insufficient_material()) {
    return "insufficient";
  }
  if (typeof chessGame.in_threefold_repetition === "function" &&
      chessGame.in_threefold_repetition()) {
    return "repetition";
  }
  return "drawRule";
}

function planQueueMatch(queue, myUid) {
  const safeUid = normalizeFirebaseKey(myUid);
  if (!safeUid || !queue || typeof queue !== "object") {
    return { queue, opponent: null };
  }

  const nextQueue = { ...queue };
  if (!nextQueue[safeUid] || nextQueue[safeUid].uid !== safeUid) {
    return { queue, opponent: null };
  }
  const entries = Object.entries(nextQueue)
    .filter(([key, entry]) =>
      key !== safeUid &&
      normalizeFirebaseKey(key) === key &&
      entry &&
      entry.uid === key
    )
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => (a.entry.joinedAt || 0) - (b.entry.joinedAt || 0));
  const match = entries[0] || null;
  const opponent = match?.entry || null;

  if (!opponent) return { queue, opponent: null };

  delete nextQueue[safeUid];
  delete nextQueue[match.key];
  return { queue: nextQueue, opponent };
}

function clockFromGameData(data, now = Date.now()) {
  if (!data?.timeControl) return null;

  const fallbackSeconds = TIME_CONTROLS[data.timeControl]?.seconds ?? 600;
  const storedWhiteSeconds = Number.isFinite(data.whiteTime)
    ? data.whiteTime
    : fallbackSeconds;
  const storedBlackSeconds = Number.isFinite(data.blackTime)
    ? data.blackTime
    : fallbackSeconds;
  const whiteTimeMs = Number.isFinite(data.whiteTimeMs)
    ? Math.max(0, data.whiteTimeMs)
    : Math.max(0, storedWhiteSeconds) * 1000;
  const blackTimeMs = Number.isFinite(data.blackTimeMs)
    ? Math.max(0, data.blackTimeMs)
    : Math.max(0, storedBlackSeconds) * 1000;
  const moves = normalizeMoves(data.moves);
  const activeColor = data.activeColor === "black" || data.activeColor === "white"
    ? data.activeColor
    : (moves.length % 2 === 0 ? "white" : "black");
  const candidateTimestamp = Number.isFinite(data.clockUpdatedAt)
    ? data.clockUpdatedAt
    : data.createdAt;
  const updatedAt = Number.isFinite(candidateTimestamp)
    ? candidateTimestamp
    : now;

  return { whiteTimeMs, blackTimeMs, activeColor, updatedAt };
}

function projectClock(clock, now = Date.now()) {
  if (!clock) return null;

  const projected = { ...clock };
  const elapsed = Math.max(0, now - clock.updatedAt);
  if (clock.activeColor === "white") {
    projected.whiteTimeMs = Math.max(0, clock.whiteTimeMs - elapsed);
  } else {
    projected.blackTimeMs = Math.max(0, clock.blackTimeMs - elapsed);
  }
  projected.updatedAt = now;
  return projected;
}

function withClockFields(data, clock) {
  if (!clock) return data;
  return {
    ...data,
    whiteTimeMs: Math.round(clock.whiteTimeMs),
    blackTimeMs: Math.round(clock.blackTimeMs),
    whiteTime: Math.ceil(clock.whiteTimeMs / 1000),
    blackTime: Math.ceil(clock.blackTimeMs / 1000),
    activeColor: clock.activeColor,
    clockUpdatedAt: clock.updatedAt,
  };
}

function finishedGameState(current, reason, winner, now, clock) {
  const result = winner === "white"
    ? "1-0"
    : winner === "black"
      ? "0-1"
      : "1/2-1/2";

  return withClockFields({
    ...current,
    status: "finished",
    finishReason: reason,
    winner: winner || null,
    result,
    finishedAt: now,
    drawOffer: null,
  }, clock);
}

function transitionGameState(current, command, now = Date.now()) {
  if (!current || current.status !== "playing" || !command) return null;

  const clock = projectClock(clockFromGameData(current, now), now);

  if (command.type === "move") {
    const remoteMoves = normalizeMoves(current.moves);
    const previousMoves = normalizeMoves(command.previousMoves);
    const nextMoves = normalizeMoves(command.moves);
    if (!sameMoves(remoteMoves, previousMoves) ||
        nextMoves.length !== previousMoves.length + 1 ||
        !sameMoves(previousMoves, nextMoves.slice(0, -1))) {
      return null;
    }

    if (clock) {
      const activeTime = clock.activeColor === "white"
        ? clock.whiteTimeMs
        : clock.blackTimeMs;
      if (activeTime <= 0) {
        return finishedGameState(
          current,
          "timeout",
          oppositeColor(clock.activeColor),
          now,
          clock
        );
      }
      clock.activeColor = oppositeColor(clock.activeColor);
      clock.updatedAt = now;
    }

    return withClockFields({
      ...current,
      moves: nextMoves,
      fen: command.fen,
    }, clock);
  }

  if (command.type !== "finish" || !FINISH_REASONS.has(command.reason)) {
    return null;
  }

  let winner = command.winner;
  if (command.reason === "timeout") {
    if (!clock) return null;
    const activeTime = clock.activeColor === "white"
      ? clock.whiteTimeMs
      : clock.blackTimeMs;
    if (activeTime > 0) return null;
    winner = oppositeColor(clock.activeColor);
  } else if (command.reason === "resign") {
    if (command.actorColor !== "white" && command.actorColor !== "black") {
      return null;
    }
    winner = oppositeColor(command.actorColor);
  } else if (command.reason === "draw") {
    if ((command.actorColor !== "white" && command.actorColor !== "black") ||
        (current.drawOffer !== "white" && current.drawOffer !== "black") ||
        current.drawOffer === command.actorColor) {
      return null;
    }
    winner = null;
  } else if (DRAW_REASONS.has(command.reason)) {
    winner = null;
  } else if (winner !== "white" && winner !== "black") {
    return null;
  }

  return finishedGameState(current, command.reason, winner, now, clock);
}

let selectedTc = null;
let isQueuing = false;
let myQueueRef = null;

// =======================
// BOARD + GAME
// =======================
const boardEl = document.getElementById("board");
if (!boardEl) throw new Error("No #board element found");

const game = new Chess();
let board = Chessboard("board", {
  draggable: false,
  position: "start",
  pieceTheme,
});

let myColor = null;
let currentGameId = null;
let currentTournamentId = null;
let gameOverHandled = false;
let finishTransitionPending = false;

// =======================
// TIMERS
// =======================
let whiteTime = 0;
let blackTime = 0;
let timerInterval = null;
let activeTimer = null;
let clockSnapshot = null;

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function renderTimers() {
  const myTimerEl = document.getElementById("whiteTimer"); // bottom = always you
  const oppTimerEl = document.getElementById("blackTimer"); // top = always opponent

  if (!myTimerEl || !oppTimerEl) return;

  const myTime = myColor === "black" ? blackTime : whiteTime;
  const oppTime = myColor === "black" ? whiteTime : blackTime;
  const myActive = activeTimer === myColor;
  const oppActive = Boolean(activeTimer) && activeTimer !== myColor;

  myTimerEl.textContent = formatTime(myTime);
  myTimerEl.className = "bar-timer" +
    (myActive ? " active" : "") +
    (myTime <= 10 && myActive ? " low" : "");

  oppTimerEl.textContent = formatTime(oppTime);
  oppTimerEl.className = "bar-timer" +
    (oppActive ? " active" : "") +
    (oppTime <= 10 && oppActive ? " low" : "");
}

function renderClockTick(now = Date.now()) {
  if (!clockSnapshot) return;
  const projected = projectClock(clockSnapshot, now);
  whiteTime = Math.ceil(projected.whiteTimeMs / 1000);
  blackTime = Math.ceil(projected.blackTimeMs / 1000);
  activeTimer = projected.activeColor;
  renderTimers();

  const activeTime = activeTimer === "white"
    ? projected.whiteTimeMs
    : projected.blackTimeMs;
  if (activeTime <= 0 && !gameOverHandled && !finishTransitionPending) {
    handleTimeout();
  }
}

function syncClockSnapshot(data) {
  const nextClock = clockFromGameData(data);
  if (!nextClock) return;
  clockSnapshot = nextClock;
  renderClockTick();
}

function startTimers(data) {
  syncClockSnapshot(data);
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(renderClockTick, 250);
}

function advanceLocalClock(nextActiveColor) {
  if (!clockSnapshot) return;
  const now = Date.now();
  clockSnapshot = {
    ...projectClock(clockSnapshot, now),
    activeColor: nextActiveColor,
    updatedAt: now,
  };
  renderClockTick(now);
}

function handleTimeout() {
  if (gameOverHandled || finishTransitionPending) return;
  requestGameFinish("timeout").catch(() => {
    const msg = document.getElementById("drawOfferMsg");
    if (msg) msg.textContent = "Unable to confirm timeout. Reconnecting...";
  });
}

// =======================
// LOBBY
// =======================
document.querySelectorAll(".tc-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (isQueuing) return;
    const tc = btn.dataset.tc;
    selectedTc = tc;
    document.querySelectorAll(".tc-btn").forEach(b => {
      b.classList.toggle("selected", b.dataset.tc === tc);
    });
    document.getElementById("playBtn").classList.add("visible");
    setQueueStatus(`Ready to play ${TIME_CONTROLS[tc].label} · Click Find Game`);
  });
});

document.getElementById("playBtn").onclick = () => {
  if (!selectedTc || isQueuing) return;
  startSearch(selectedTc);
};

document.getElementById("cancelBtn").onclick = () => {
  cancelQueue();
};

function startSearch(tc) {
  const safeTimeControl = normalizeTimeControl(tc);
  if (!safeTimeControl) {
    handleFirebaseUnavailable("Select a valid time control.");
    return;
  }

  isQueuing = true;
  document.querySelectorAll(".tc-btn").forEach(b => b.disabled = true);
  document.getElementById("playBtn").classList.remove("visible");
  document.getElementById("cancelBtn").classList.add("visible");
  setQueueStatus(
    `🔍 Searching for ${TIME_CONTROLS[safeTimeControl].label} game...`,
    true
  );

  waitForFirebase(() => {
    initializeFirebaseSession();
    const uid = window.myUid;
    const username = window.myUsername;
    if (!uid) {
      handleFirebaseUnavailable("Your account is still loading. Try Find Game again.");
      return;
    }
    joinQueue(uid, username, safeTimeControl);
  }, {
    onTimeout: () => handleFirebaseUnavailable(
      "Online play is unavailable. Check your connection, then try again."
    ),
  });
}

function cancelQueue() {
  isQueuing = false;
  document.querySelectorAll(".tc-btn").forEach(b => b.disabled = false);
  document.getElementById("cancelBtn").classList.remove("visible");
  if (selectedTc) document.getElementById("playBtn").classList.add("visible");
  setQueueStatus(selectedTc
    ? `Ready to play ${TIME_CONTROLS[selectedTc].label} · Click Find Game`
    : "Select a time control to play"
  );

  if (myQueueRef) {
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
      .then(({ remove }) => remove(myQueueRef));
    myQueueRef = null;
  }
}

function setQueueStatus(msg, searching = false) {
  const el = document.getElementById("queueStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = "queue-status" + (searching ? " searching" : "");
}

// =======================
// DRAG GUARDS
// =======================
function onDragStart(source, piece) {
  if (!currentGameId || gameOverHandled || finishTransitionPending) return false;
  if (myColor === "white" && game.turn() !== "w") return false;
  if (myColor === "black" && game.turn() !== "b") return false;

  const s = window.getSettings ? window.getSettings() : {};
  if (s.legalMoves) {
    clearLegalDots();
    const moves = game.moves({ square: source, verbose: true });
    moves.forEach(m => {
      const el = document.querySelector(`.square-${m.to}`);
      if (!el) return;
      if (m.captured) el.classList.add("legal-dot-capture");
      else el.classList.add("legal-dot");
    });
  }
  return true;
}

function clearLegalDots() {
  document.querySelectorAll(".legal-dot, .legal-dot-capture").forEach(el => {
    el.classList.remove("legal-dot", "legal-dot-capture");
  });
}

function onDrop(source, target) {
  clearLegalDots();
  const move = game.move({ from: source, to: target, promotion: "q" });
  if (!move) return "snapback";
  board.position(game.fen(), false);
  playSound(soundForMove(move, game));

  const nextActive = game.turn() === "w" ? "white" : "black";
  advanceLocalClock(nextActive);

  pushMove().catch(() => {
    if (latestGameData) {
      reconcileGameMoves(latestGameData, false);
      if (latestGameData.timeControl) syncClockSnapshot(latestGameData);
    }
    setQueueStatus("Move could not be confirmed. Reconnecting...");
  });
}

// =======================
// PUSH MOVE TO FIREBASE
// =======================
async function runGameTransition(command) {
  const gameId = normalizeFirebaseKey(currentGameId);
  if (!gameId || !window.firebaseDb) {
    return { committed: false, snapshot: null };
  }

  const { ref, runTransaction } =
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  return runTransaction(ref(window.firebaseDb, `games/${gameId}`), current => {
    const next = transitionGameState(current, command, Date.now());
    return next ?? undefined;
  }, { applyLocally: false });
}

async function pushMove() {
  if (!currentGameId) return false;

  const moves = game.history();
  const transaction = await runGameTransition({
    type: "move",
    previousMoves: moves.slice(0, -1),
    moves,
    fen: game.fen(),
  });
  const data = transaction.snapshot?.val?.();

  if (data?.status === "finished") {
    reconcileGameMoves(data, false);
    handleFinishedGame(data);
  } else if (!transaction.committed && data) {
    reconcileGameMoves(data, false);
    if (data.timeControl) syncClockSnapshot(data);
  }

  return transaction.committed;
}

async function requestGameFinish(reason, winner = null) {
  if (gameOverHandled || finishTransitionPending || !currentGameId) return false;

  finishTransitionPending = true;
  try {
    const transaction = await runGameTransition({
      type: "finish",
      reason,
      winner,
      actorColor: myColor,
    });
    const data = transaction.snapshot?.val?.();

    if (data?.status === "finished") {
      handleFinishedGame(data);
    } else if (data?.timeControl) {
      syncClockSnapshot(data);
    }
    return transaction.committed;
  } finally {
    finishTransitionPending = false;
  }
}

function resultForFinishedGame(data) {
  return resultForColor(data, myColor) || "draw";
}

function handleFinishedGame(data) {
  if (gameOverHandled) return;
  gameOverHandled = true;
  finishTransitionPending = false;
  clearInterval(timerInterval);

  if (data.timeControl) syncClockSnapshot(data);

  const reason = FINISH_REASONS.has(data.finishReason)
    ? data.finishReason
    : data.resigned
      ? "resign"
      : data.drawAccepted
        ? "draw"
        : "drawRule";
  const result = resultForFinishedGame(data);
  showGameOver(result, reason);
  saveGameResult(data, result).catch(() => {
    const msg = document.getElementById("drawOfferMsg");
    if (msg) msg.textContent = "Game finished, but profile updates are pending.";
  });
}

function reconcileGameMoves(data, animate = true) {
  const remoteMoves = normalizeMoves(data.moves);
  const localMoves = game.history();
  if (sameMoves(remoteMoves, localMoves)) return true;

  game.reset();
  for (const san of remoteMoves) {
    if (!game.move(san)) return false;
  }
  board.position(game.fen(), animate);

  if (remoteMoves.length > localMoves.length) {
    const lastMove = game.history({ verbose: true }).at(-1);
    playSound(soundForMove({ captured: lastMove?.captured }, game));
  }
  return true;
}

// =======================
// LISTEN TO GAME
// =======================
let currentWhiteData = null;
let currentBlackData = null;
let latestGameData = null;
let timersStarted = false;

function listenToGame(gameId) {
  const safeGameId = normalizeFirebaseKey(gameId);
  const safeUid = normalizeFirebaseKey(window.myUid);
  if (!safeGameId || !safeUid) {
    setQueueStatus("Game data could not be validated.");
    return;
  }

  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, onValue }) => {
      const db = window.firebaseDb;

      onValue(ref(db, `games/${safeGameId}`), (snap) => {
        const data = snap.val();
        if (!data) return;
        if (!["playing", "finished"].includes(data.status) ||
            colorForUser(data, safeUid) !== myColor) {
          setQueueStatus("Game access could not be validated.");
          return;
        }

        latestGameData = data;
        currentWhiteData = data.white;
        currentBlackData = data.black;
        if (!reconcileGameMoves(data)) {
          setQueueStatus("Game data could not be synchronized.");
          return;
        }
        updatePlayerBars(data);

        if (data.status === "finished") {
          handleFinishedGame(data);
          return;
        }

        if (data.timeControl) {
          if (!timersStarted) {
            timersStarted = true;
            startTimers(data);
          } else {
            syncClockSnapshot(data);
          }
        }

        // Upgrade legacy terminal flags through the guarded state transition.
        if ((data.resigned === "white" || data.resigned === "black") &&
            !gameOverHandled) {
          requestGameFinish("resign", oppositeColor(data.resigned));
          return;
        }

        if (data.drawAccepted && !gameOverHandled) {
          requestGameFinish("draw");
          return;
        }

        // Show incoming draw offer
        if (data.drawOffer && data.drawOffer !== myColor) {
          document.getElementById("drawOfferIncoming").classList.remove("hidden");
        } else {
          document.getElementById("drawOfferIncoming").classList.add("hidden");
        }

        // Clear draw offer msg if opponent declined
        if (!data.drawOffer) {
          const msg = document.getElementById("drawOfferMsg");
          if (msg.textContent === "Draw offer sent...") {
            msg.textContent = "Draw offer declined.";
            msg.style.color = "#e05c5c";
            document.getElementById("drawOfferBtn").disabled = false;
          }
        }

        if (game.game_over() && !gameOverHandled) {
          const reason = getGameOverReason(game);
          const winner = reason === "checkmate"
            ? oppositeColor(game.turn() === "w" ? "white" : "black")
            : null;
          requestGameFinish(reason, winner);
        }
      });
    });
}

// =======================
// START GAME
// =======================
function startGame(gameId, color, tc) {
  const safeGameId = normalizeFirebaseKey(gameId);
  const safeTimeControl = normalizeTimeControl(tc);
  if (!safeGameId ||
      !safeTimeControl ||
      (color !== "white" && color !== "black")) {
    setQueueStatus("Game access could not be validated.");
    return false;
  }

  currentGameId = safeGameId;
  myColor = color;
  gameOverHandled = false;
  finishTransitionPending = false;
  timersStarted = false;
  isQueuing = false;
  latestGameData = null;
  clockSnapshot = null;
  activeTimer = null;
  clearInterval(timerInterval);
  game.reset();

  document.querySelectorAll(".tc-btn").forEach(b => {
    b.classList.remove("queuing", "active", "selected");
    b.disabled = false;
  });
  document.getElementById("playBtn").classList.remove("visible");
  document.getElementById("cancelBtn").classList.remove("visible");
  document.getElementById("gameActions").style.display = "flex";
  document.getElementById("drawOfferMsg").textContent = "";
  document.getElementById("drawOfferBtn").disabled = false;
  document.getElementById("drawOfferIncoming").classList.add("hidden");
  setQueueStatus("Game in progress...");

  board.destroy();
  board = Chessboard("board", {
    position: "start",
    draggable: true,
    orientation: color,
    moveSpeed: 200,
    snapSpeed: 150,
    snapbackSpeed: 200,
    pieceTheme,
    onDrop,
    onDragStart,
    onSnapbackEnd: () => clearLegalDots(),
  });

  const secs = TIME_CONTROLS[safeTimeControl].seconds;
  whiteTime = secs;
  blackTime = secs;
  renderTimers();

  listenToGame(safeGameId);
  return true;
}

// =======================
// GAME OVER UI
// =======================
function showGameOver(result, reason) {
  const overlay = document.getElementById("gameoverOverlay");
  const icon = document.getElementById("goIcon");
  const title = document.getElementById("goTitle");
  const sub = document.getElementById("goSub");
  const rating = document.getElementById("goRating");

  const reasonMap = {
    checkmate: "by checkmate",
    timeout: "on time",
    stalemate: "by stalemate",
    repetition: "by threefold repetition",
    insufficient: "by insufficient material",
    drawRule: "by draw rule",
    draw: "by agreement",
    resign: "by resignation",
  };

  if (result === "win") {
    icon.textContent = "";
    title.textContent = "You Won!";
    title.style.color = "#4caf7d";
  } else if (result === "loss") {
    icon.textContent = "";
    title.textContent = "You Lost";
    title.style.color = "#e05c5c";
  } else {
    icon.textContent = "";
    title.textContent = "Draw";
    title.style.color = "var(--muted)";
  }

  sub.textContent = reasonMap[reason] || "";

  const change = result === "win" ? 10 : result === "loss" ? -10 : 0;
  rating.className = `gameover-rating ${result}`;
  rating.textContent = change >= 0 ? `+${change} rating` : `${change} rating`;
  rating.classList.remove("hidden");

  overlay.classList.remove("hidden");
}

document.getElementById("goPlayAgain").onclick = () => {
  document.getElementById("gameoverOverlay").classList.add("hidden");
  document.getElementById("gameActions").style.display = "none";
  currentGameId = null;
  currentTournamentId = null;
  gameOverHandled = false;
  finishTransitionPending = false;
  timersStarted = false;
  myColor = null;
  clearInterval(timerInterval);
  clockSnapshot = null;
  activeTimer = null;
  whiteTime = 0;
  blackTime = 0;
  document.getElementById("goArena").classList.add("hidden");
  document.getElementById("goPlayAgain").classList.remove("hidden");
  document.getElementById("whiteTimer").textContent = "—:——";
  document.getElementById("blackTimer").textContent = "—:——";
  game.reset();
  board.destroy();
  board = Chessboard("board", {
    draggable: false,
    position: "start",
    pieceTheme,
  });
  setQueueStatus("Select a time control to play");
};

document.getElementById("goHome").onclick = () => {
  window.location.href = "index.html";
};

document.getElementById("goArena").onclick = () => {
  window.location.href = `arena.html`;
};

// =======================
// PLAYER BARS
// =======================
const TITLE_LABELS = {
  dev: { label: "DEV", color: "#74ebcb" },
  gm: { label: "GM", color: "#f0c040" },
  im: { label: "IM", color: "#aaaaaa" },
  fm: { label: "FM", color: "#d4956a" },
  cm: { label: "CM", color: "#7ecf7e" },
  nm: { label: "NM", color: "#7ab8e0" },
  mod: { label: "Mod", color: "#f08080" },
};

async function fetchUserData(uid) {
  const safeUid = normalizeFirebaseKey(uid);
  if (!safeUid) return { title: null, rating: null, avatar: null };
  const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const [titleSnap, ratingSnap, avatarSnap] = await Promise.all([
    get(ref(window.firebaseDb, `users/${safeUid}/title`)),
    get(ref(window.firebaseDb, `users/${safeUid}/rating`)),
    get(ref(window.firebaseDb, `users/${safeUid}/avatarUrl`)),
  ]);
  return {
    title: titleSnap.val() || null,
    rating: ratingSnap.val() ?? null,
    avatar: avatarSnap.val() || null,
  };
}

function setAvatar(elId, url, letter) {
  const el = document.getElementById(elId);
  if (!el) return;
  const avatarUrl = safeAvatarUrl(url);
  if (avatarUrl) {
    el.style.backgroundImage = `url(${JSON.stringify(avatarUrl)})`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.fontSize = "0";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.fontSize = "";
    el.textContent = normalizeDisplayName(letter, "?").slice(0, 1).toUpperCase();
  }
}

function renderPlayerName(el, username, titleKey, isYou = false) {
  if (!el) return;
  const title = titleKey && TITLE_LABELS[titleKey];
  const displayName = normalizeDisplayName(username, "Player");

  el.textContent = "";
  if (title) {
    const titleEl = document.createElement("span");
    titleEl.className = "bar-title";
    titleEl.style.color = title.color;
    titleEl.textContent = title.label;
    el.appendChild(titleEl);
    el.appendChild(document.createTextNode(" "));
  }
  el.appendChild(document.createTextNode(displayName));

  if (isYou) {
    const youEl = document.createElement("span");
    youEl.className = "bar-you";
    youEl.textContent = "";
    el.appendChild(youEl);
  }
}

async function updatePlayerBars(data) {
  const whiteUsername = normalizeDisplayName(data.white?.username, "White");
  const blackUsername = normalizeDisplayName(data.black?.username, "Black");
  const whiteUid = data.white?.uid;
  const blackUid = data.black?.uid;

  const [wData, bData] = await Promise.all([
    fetchUserData(whiteUid),
    fetchUserData(blackUid),
  ]);

  // My data vs opponent data
  const myData = myColor === "white" ? wData : bData;
  const oppData = myColor === "white" ? bData : wData;
  const myUsername = myColor === "white" ? whiteUsername : blackUsername;
  const oppUsername = myColor === "white" ? blackUsername : whiteUsername;

  // Bottom bar = you, top bar = opponent
  const bottomName = document.getElementById("whiteName");
  const bottomRating = document.getElementById("whiteRating");
  const topName = document.getElementById("blackName");
  const topRating = document.getElementById("blackRating");

  setAvatar("whiteAvatar", myData.avatar, myUsername[0].toUpperCase());
  setAvatar("blackAvatar", oppData.avatar, oppUsername[0].toUpperCase());

  renderPlayerName(bottomName, myUsername, myData.title, true);
  if (bottomRating) bottomRating.textContent = myData.rating ? `(${myData.rating})` : "";
  renderPlayerName(topName, oppUsername, oppData.title);
  if (topRating) topRating.textContent = oppData.rating ? `(${oppData.rating})` : "";
}

// =======================
// SAVE GAME RESULT
// =======================
async function saveGameResult(data, result, options = {}) {
  const firebaseApi = options.firebaseApi ||
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const { ref, runTransaction } = firebaseApi;
  const db = options.db || window.firebaseDb;
  const safeUid = normalizeFirebaseKey(options.uid ?? window.myUid);
  const finishedGameId = normalizeFirebaseKey(options.gameId ?? currentGameId);
  const finishedColor = options.color ?? myColor;
  const canonicalResult = resultForColor(data, finishedColor);
  const participantColor = colorForUser(data, safeUid);

  if (!db ||
      !safeUid ||
      !finishedGameId ||
      participantColor !== finishedColor ||
      canonicalResult !== result) {
    throw new Error("Finished game result could not be validated.");
  }

  const opponentData = finishedColor === "white" ? data.black : data.white;
  const opponentUid = normalizeFirebaseKey(opponentData?.uid);
  if (!opponentUid || opponentUid === safeUid) {
    throw new Error("Finished game participants could not be validated.");
  }

  const finishedTournamentId = resolveTournamentContext(
    options.tournamentId ?? currentTournamentId,
    data
  );
  const now = options.now || Date.now;
  const claim = {
    gameId: finishedGameId,
    result,
    myColor: finishedColor,
    opponentUid,
    opponentUsername: normalizeDisplayName(opponentData?.username, "Unknown"),
    moveCount: normalizeMoves(data.moves).length,
    playedAt: Number.isFinite(data.finishedAt) ? data.finishedAt : now(),
    timeControl: normalizeTimeControl(data.timeControl) ||
      normalizeTimeControl(selectedTc) ||
      "rapid",
    tournamentId: finishedTournamentId,
  };

  const profileTransaction = await runTransaction(
    ref(db, `users/${safeUid}`),
    user => applyUserGameResult(user, claim),
    { applyLocally: false }
  );
  const storedUser = profileTransaction.snapshot?.val?.();
  const storedClaim = storedUser?.resultClaims?.[finishedGameId];
  if (!resultClaimMatches(storedClaim, claim)) {
    throw new Error("Game result claim conflicted with stored profile data.");
  }

  let tournamentCommitted = false;
  if (finishedTournamentId && storedClaim.tournamentEligible === true) {
    tournamentCommitted = await saveTournamentResult(
      result,
      finishedTournamentId,
      finishedGameId,
      {
        firebaseApi,
        db,
        uid: safeUid,
        appliedAt: storedClaim.appliedAt,
      }
    );
  }

  return {
    profileCommitted: profileTransaction.committed,
    tournamentCommitted,
    legacyResult: storedClaim.legacyHistory === true,
  };
}

// =======================
// SAVE TOURNAMENT RESULT
// =======================
async function saveTournamentResult(
  result,
  tournamentId,
  gameId,
  options = {}
) {
  const firebaseApi = options.firebaseApi ||
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const { ref, runTransaction } = firebaseApi;
  const db = options.db || window.firebaseDb;
  const safeUid = normalizeFirebaseKey(options.uid ?? window.myUid);
  const safeTournamentId = normalizeFirebaseKey(tournamentId);
  const safeGameId = normalizeFirebaseKey(gameId);
  if (!db ||
      !safeUid ||
      !safeTournamentId ||
      !safeGameId ||
      !["win", "loss", "draw"].includes(result)) {
    throw new Error("Tournament result could not be validated.");
  }

  const claim = {
    gameId: safeGameId,
    result,
    appliedAt: Number.isFinite(options.appliedAt)
      ? options.appliedAt
      : Date.now(),
  };
  const transaction = await runTransaction(
    ref(db, `tournaments/${safeTournamentId}/players/${safeUid}`),
    player => applyTournamentGameResult(player, claim),
    { applyLocally: false }
  );
  const storedPlayer = transaction.snapshot?.val?.();
  if (!tournamentResultClaimMatches(
    storedPlayer?.resultClaims?.[safeGameId],
    claim
  )) {
    throw new Error("Tournament result claim conflicted with stored score.");
  }
  return transaction.committed;
}

// =======================
// WAIT FOR FIREBASE
// =======================
function isFirebaseReady() {
  return Boolean(
    window.firebaseDb &&
    window.firebaseAuth &&
    typeof window.firebaseOnAuthChanged === "function"
  );
}

function waitForFirebase(cb, options = {}) {
  const timeoutMs = options.timeoutMs ?? FIREBASE_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? FIREBASE_POLL_INTERVAL_MS;
  const now = options.now || Date.now;
  const schedule = options.schedule || setTimeout;
  const onTimeout = options.onTimeout || (() => {
    handleFirebaseUnavailable(
      "Online play is unavailable. Reload the page to try again."
    );
  });
  const startedAt = now();
  let settled = false;

  const poll = () => {
    if (settled) return;
    if (isFirebaseReady()) {
      settled = true;
      cb();
      return;
    }
    if (now() - startedAt >= timeoutMs) {
      settled = true;
      onTimeout();
      return;
    }
    schedule(poll, pollMs);
  };

  poll();
  return () => {
    settled = true;
  };
}

function handleFirebaseUnavailable(message) {
  isQueuing = false;
  document.querySelectorAll(".tc-btn").forEach(button => {
    button.disabled = false;
  });
  document.getElementById("cancelBtn")?.classList.remove("visible");
  if (selectedTc) document.getElementById("playBtn")?.classList.add("visible");
  setQueueStatus(message);
}

// =======================
// QUEUE
// =======================
function joinQueue(uid, username, tc) {
  const safeUid = normalizeFirebaseKey(uid);
  const safeTimeControl = normalizeTimeControl(tc);
  if (!safeUid || !safeTimeControl) {
    handleFirebaseUnavailable("Unable to join the queue with this account.");
    return;
  }

  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(async ({ ref, set, remove, onDisconnect }) => {
      const db = window.firebaseDb;
      myQueueRef = ref(db, `queue/${safeTimeControl}/${safeUid}`);
      const queueRef = myQueueRef;
      await set(queueRef, {
        uid: safeUid,
        username: normalizeDisplayName(username, "Player"),
        joinedAt: Date.now(),
        tc: safeTimeControl,
      });
      if (!isQueuing) {
        await remove(queueRef);
        if (myQueueRef === queueRef) myQueueRef = null;
        return;
      }
      onDisconnect(myQueueRef).remove();
      tryMatch(safeUid, username, safeTimeControl);
    })
    .catch(() => {
      handleFirebaseUnavailable("Unable to join the queue. Try again.");
    });
}

function tryMatch(myUid, myUsername, tc) {
  const safeUid = normalizeFirebaseKey(myUid);
  const safeTimeControl = normalizeTimeControl(tc);
  if (!safeUid || !safeTimeControl) {
    handleFirebaseUnavailable("Unable to match this queue entry.");
    return;
  }

  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, runTransaction }) => {
      const db = window.firebaseDb;
      const queueRef = ref(db, `queue/${safeTimeControl}`);
      let matchedOpponent = null;

      return runTransaction(queueRef, (queue) => {
        const plan = planQueueMatch(queue, safeUid);
        matchedOpponent = plan.opponent;
        return plan.queue;
      }).then(async (result) => {
        if (!result.committed) return;
        if (matchedOpponent) {
          await createGame(
            safeUid,
            myUsername,
            matchedOpponent.uid,
            matchedOpponent.username,
            safeTimeControl
          );
        } else {
          await listenForGame(safeUid, safeTimeControl);
        }
      });
    })
    .catch(() => {
      handleFirebaseUnavailable("Unable to create or join a game. Try again.");
    });
}

async function createGame(
  whiteUid,
  whiteUsername,
  blackUid,
  blackUsername,
  tc,
  options = {}
) {
  const safeWhiteUid = normalizeFirebaseKey(whiteUid);
  const safeBlackUid = normalizeFirebaseKey(blackUid);
  const safeTimeControl = normalizeTimeControl(tc);
  if (!safeWhiteUid ||
      !safeBlackUid ||
      safeWhiteUid === safeBlackUid ||
      !safeTimeControl) {
    throw new Error("Game participants or time control are invalid.");
  }

  const firebaseApi = options.firebaseApi ||
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const { ref, update, push } = firebaseApi;
  const db = options.db || window.firebaseDb;
  if (!db) throw new Error("Firebase is unavailable.");

  const gameRef = push(ref(db, "games"));
  const gameId = normalizeFirebaseKey(gameRef.key);
  if (!gameId) throw new Error("Firebase returned an invalid game id.");

  const secs = TIME_CONTROLS[safeTimeControl].seconds;
  const createdAt = (options.now || Date.now)();
  const gameData = {
    white: {
      uid: safeWhiteUid,
      username: normalizeDisplayName(whiteUsername, "White"),
    },
    black: {
      uid: safeBlackUid,
      username: normalizeDisplayName(blackUsername, "Black"),
    },
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    moves: [],
    status: "playing",
    timeControl: safeTimeControl,
    whiteTime: secs,
    blackTime: secs,
    whiteTimeMs: secs * 1000,
    blackTimeMs: secs * 1000,
    activeColor: "white",
    clockUpdatedAt: createdAt,
    createdAt,
  };
  const updates = {
    [`games/${gameId}`]: gameData,
    [`users/${safeWhiteUid}/currentGame`]: gameId,
    [`users/${safeBlackUid}/currentGame`]: gameId,
  };

  await update(ref(db), updates);
  const start = options.startGame || startGame;
  start(gameId, "white", safeTimeControl);
  return gameId;
}

async function listenForGame(uid, tc, options = {}) {
  const safeUid = normalizeFirebaseKey(uid);
  const fallbackTimeControl = normalizeTimeControl(tc);
  if (!safeUid) {
    throw new Error("Queue user id is invalid.");
  }

  const firebaseApi = options.firebaseApi ||
    await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const { ref, onValue, get } = firebaseApi;
  const db = options.db || window.firebaseDb;
  if (!db) throw new Error("Firebase is unavailable.");

  let checkingGame = false;
  let unsubscribe = () => {};
  unsubscribe = onValue(
    ref(db, `users/${safeUid}/currentGame`),
    async snap => {
      if (!snap.exists() || currentGameId || checkingGame) return;

      const gameId = normalizeFirebaseKey(snap.val());
      if (!gameId) {
        setQueueStatus("Matched game id could not be validated.");
        return;
      }

      checkingGame = true;
      try {
        const gameSnap = await get(ref(db, `games/${gameId}`));
        const gameData = gameSnap.val();
        const color = colorForUser(gameData, safeUid);
        if (!gameData ||
            !["playing", "finished"].includes(gameData.status) ||
            !color) {
          setQueueStatus("Matched game access could not be validated.");
          return;
        }

        const gameTimeControl = normalizeTimeControl(gameData.timeControl) ||
          fallbackTimeControl;
        if (!gameTimeControl) {
          setQueueStatus("Matched game time control could not be validated.");
          return;
        }

        unsubscribe();
        const start = options.startGame || startGame;
        start(gameId, color, gameTimeControl);
      } catch {
        setQueueStatus("Matched game could not be loaded. Reconnecting...");
      } finally {
        checkingGame = false;
      }
    }
  );
  return unsubscribe;
}

// =======================
// RESIGN + DRAW
// =======================
document.getElementById("resignBtn").onclick = () => {
  if (!currentGameId || gameOverHandled) return;
  if (!confirm("Are you sure you want to resign?")) return;
  handleResign().catch(() => {
    document.getElementById("drawOfferMsg").textContent =
      "Unable to resign right now. Try again.";
  });
};

async function handleResign() {
  if (gameOverHandled || finishTransitionPending) return false;
  return requestGameFinish("resign", oppositeColor(myColor));
}

document.getElementById("drawOfferBtn").onclick = async () => {
  const gameId = normalizeFirebaseKey(currentGameId);
  if (!gameId || gameOverHandled) return;
  const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  await set(ref(window.firebaseDb, `games/${gameId}/drawOffer`), myColor);
  const msg = document.getElementById("drawOfferMsg");
  msg.textContent = "Draw offer sent...";
  msg.style.color = "var(--accent)";
  document.getElementById("drawOfferBtn").disabled = true;
};

document.getElementById("acceptDrawBtn").onclick = async () => {
  if (!currentGameId || gameOverHandled) return;
  try {
    await requestGameFinish("draw");
  } catch {
    document.getElementById("drawOfferMsg").textContent =
      "Unable to accept the draw right now. Try again.";
  }
};

document.getElementById("declineDrawBtn").onclick = async () => {
  const gameId = normalizeFirebaseKey(currentGameId);
  if (!gameId) return;
  const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  await set(ref(window.firebaseDb, `games/${gameId}/drawOffer`), null);
  document.getElementById("drawOfferIncoming").classList.add("hidden");
};

// =======================
// SOUND SYSTEM
// =======================
const sounds = {
  move: new Audio("sounds/move-self.mp3"),
  capture: new Audio("sounds/capture.mp3"),
  check: new Audio("sounds/move-check.mp3"),
};

function playSound(name) {
  const s2 = window.getSettings ? window.getSettings() : {};
  if (!s2.sound) return;
  const s = sounds[name];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => { });
}

function soundForMove(move, chessGame) {
  if (chessGame.in_check()) return "check";
  if (move.captured) return "capture";
  return "move";
}

async function loadMyAvatar() {
  const uid = normalizeFirebaseKey(window.myUid);
  if (!uid) return;
  const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const snap = await get(ref(window.firebaseDb, `users/${uid}/avatarUrl`));
  const username = window.myUsername || "?";

  setAvatar("whiteAvatar", snap.val() || null, username[0].toUpperCase());
  setAvatar("blackAvatar", null, "?");

  // Show name in both bars (we don't know color yet so put it in bottom bar)
  const nameEl = document.getElementById("whiteName");
  const ratingEl = document.getElementById("whiteRating");

  if (nameEl) nameEl.textContent = username;

  // Also fetch and show rating
  const ratingSnap = await get(ref(window.firebaseDb, `users/${uid}/rating`));
  if (ratingEl && ratingSnap.val()) ratingEl.textContent = `(${ratingSnap.val()})`;
}

// =======================
// INIT
// =======================
let authListenerRegistered = false;

function colorForUser(gameData, uid) {
  const safeUid = normalizeFirebaseKey(uid);
  const whiteUid = normalizeFirebaseKey(gameData?.white?.uid);
  const blackUid = normalizeFirebaseKey(gameData?.black?.uid);
  if (!safeUid || !whiteUid || !blackUid || whiteUid === blackUid) return null;
  if (whiteUid === safeUid) return "white";
  if (blackUid === safeUid) return "black";
  return null;
}

function applyTournamentModeUi() {
  if (!currentTournamentId) return;
  window.history.replaceState({}, "", "play.html");
  document.getElementById("goArena")?.classList.remove("hidden");
  document.getElementById("goPlayAgain")?.classList.add("hidden");
}

function initializeFirebaseSession() {
  if (authListenerRegistered || !isFirebaseReady()) return;
  authListenerRegistered = true;

  window.firebaseOnAuthChanged(window.firebaseAuth, user => {
    if (!user) { window.location.href = "login.html"; return; }
    const safeUserUid = normalizeFirebaseKey(user.uid);
    if (!safeUserUid) {
      handleFirebaseUnavailable("This account id could not be validated.");
      return;
    }

    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
      .then(async ({ ref, get }) => {
        try {
          const usernameSnap = await get(
            ref(window.firebaseDb, `users/${safeUserUid}/username`)
          );
          const username = normalizeDisplayName(usernameSnap.val() || user.email, "Player");
          window.myUid = safeUserUid;
          window.myUsername = username;
          loadMyAvatar().catch(() => {});

          const params = new URLSearchParams(window.location.search);
          const challengeId = normalizeFirebaseKey(params.get("challenge"));
          currentTournamentId = resolveTournamentContext(
            params.get("tournament"),
            null
          );

          if (challengeId) {
            const challengeSnap = await get(ref(window.firebaseDb, `games/${challengeId}`));
            const challengeGame = challengeSnap.val();
            const challengeColor = colorForUser(challengeGame, safeUserUid);
            if (!challengeGame ||
                !["playing", "finished"].includes(challengeGame.status) ||
                !challengeColor) {
              handleFirebaseUnavailable("This challenge is unavailable.");
              return;
            }

            currentTournamentId = resolveTournamentContext(
              currentTournamentId,
              challengeGame
            );
            if (currentTournamentId) applyTournamentModeUi();
            window.history.replaceState({}, "", "play.html");
            startGame(challengeId, challengeColor, challengeGame.timeControl);
            return;
          }

          const gameSnap = await get(
            ref(window.firebaseDb, `users/${safeUserUid}/currentGame`)
          );
          if (!gameSnap.exists()) return;

          const gameId = normalizeFirebaseKey(gameSnap.val());
          if (!gameId) return;
          const gameDataSnap = await get(ref(window.firebaseDb, `games/${gameId}`));
          const gameData = gameDataSnap.val();
          const color = colorForUser(gameData, safeUserUid);
          if (!gameData ||
              !["playing", "finished"].includes(gameData.status) ||
              !color) {
            return;
          }

          currentTournamentId = resolveTournamentContext(
            currentTournamentId,
            gameData
          );
          if (currentTournamentId) applyTournamentModeUi();
          startGame(gameId, color, gameData.timeControl);
        } catch {
          authListenerRegistered = false;
          handleFirebaseUnavailable(
            "Online play could not load. Check your connection, then try again."
          );
        }
      });
  });
}

function initializePlayPage() {
  waitForFirebase(initializeFirebaseSession, {
    onTimeout: () => handleFirebaseUnavailable(
      "Online play did not load. Check your connection, then reload the page."
    ),
  });
}

if (!window.__FAITHCHESS_TEST_MODE__) {
  initializePlayPage();
}
