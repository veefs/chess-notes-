const settings = window.getSettings ? window.getSettings() : {};
const pieceSet = settings.pieceSet || "cburnett";

// =======================
// TIME CONTROLS
// =======================
const TIME_CONTROLS = {
  bullet: { label: "Bullet", seconds: 60 },
  blitz: { label: "Blitz", seconds: 300 },
  rapid: { label: "Rapid", seconds: 600 },
};
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

let selectedTc = null;
let isQueuing = false;
let myQueueRef = null;
let currentGameUnsub = null;
let claimInFlight = false;
let claimAttemptPromise = null;
let currentTournamentId = null;

// =======================
// BOARD + GAME
// =======================
const boardEl = document.getElementById("board");
if (!boardEl) throw new Error("No #board element found");

const game = new Chess();
let board = Chessboard("board", {
  draggable: false,
  position: "start",
  pieceTheme: `pieces/${pieceSet}/{piece}.svg`,
});

let myColor = null;
let currentGameId = null;
let gameOverHandled = false;
let currentTimeControl = null;

// =======================
// TIMERS
// =======================
let whiteTime = 0;
let blackTime = 0;
let timerInterval = null;
let activeTimer = null;
let clockWriteInFlight = false;

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function readClock(data, color, fallback) {
  const nested = data?.clocks?.[color];
  const legacy = data?.[`${color}Time`];
  const value = Number.isFinite(nested) ? nested : legacy;
  return Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function renderTimers() {
  const myTimerEl = document.getElementById("whiteTimer"); // bottom = always you
  const oppTimerEl = document.getElementById("blackTimer"); // top = always opponent

  if (!myTimerEl || !oppTimerEl) return;

  const myTime = myColor === "black" ? blackTime : whiteTime;
  const oppTime = myColor === "black" ? whiteTime : blackTime;
  const myActive = activeTimer === myColor;
  const oppActive = !myActive;

  myTimerEl.textContent = formatTime(myTime);
  myTimerEl.className = "bar-timer" +
    (myActive ? " active" : "") +
    (myTime <= 10 && myActive ? " low" : "");

  oppTimerEl.textContent = formatTime(oppTime);
  oppTimerEl.className = "bar-timer" +
    (oppActive ? " active" : "") +
    (oppTime <= 10 && oppActive ? " low" : "");
}

function startTimers(data) {
  if (timerInterval) clearInterval(timerInterval);

  if (data?.position?.turnUid === data?.white?.uid) activeTimer = "white";
  else if (data?.position?.turnUid === data?.black?.uid) activeTimer = "black";
  else activeTimer = game.turn() === "w" ? "white" : "black";

  const defaultTime = TIME_CONTROLS[data?.timeControl]?.seconds ?? 600;
  whiteTime = readClock(data, "white", defaultTime);
  blackTime = readClock(data, "black", defaultTime);

  renderTimers();

  timerInterval = setInterval(() => {
    if (activeTimer === "white") whiteTime--;
    else blackTime--;

    if (whiteTime <= 0 || blackTime <= 0) {
      clearInterval(timerInterval);
      const winner = whiteTime <= 0 ? "black" : "white";
      handleTimeout(winner);
      return;
    }

    renderTimers();
    pushTimes();
  }, 1000);
}

async function pushTimes() {
  if (
    !currentGameId
    || !myColor
    || activeTimer !== myColor
    || clockWriteInFlight
  ) {
    return;
  }

  clockWriteInFlight = true;
  const gameId = currentGameId;
  const color = myColor;
  const value = color === "white" ? whiteTime : blackTime;
  try {
    const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
    await set(ref(window.firebaseDb, `games/${gameId}/clocks/${color}`), value);
  } catch (error) {
    console.warn("Clock update rejected:", error);
  } finally {
    clockWriteInFlight = false;
  }
}

function handleTimeout(winner) {
  if (gameOverHandled) return;
  gameOverHandled = true;
  const result = (winner === myColor) ? "win" : "loss";
  showGameOver(result, "timeout");
  saveGameResult({ white: currentWhiteData, black: currentBlackData }, result);
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
  void cancelQueue();
};

function startSearch(tc) {
  isQueuing = true;
  document.querySelectorAll(".tc-btn").forEach(b => b.disabled = true);
  document.getElementById("playBtn").classList.remove("visible");
  document.getElementById("cancelBtn").classList.add("visible");
  setQueueStatus(`🔍 Searching for ${TIME_CONTROLS[tc].label} game...`, true);

  waitForFirebase(() => {
    const uid = window.myUid;
    const username = window.myUsername;
    if (!uid) return;
    joinQueue(uid, username, tc);
  });
}

async function cancelQueue() {
  isQueuing = false;
  document.querySelectorAll(".tc-btn").forEach(b => b.disabled = false);
  document.getElementById("cancelBtn").classList.remove("visible");
  if (selectedTc) document.getElementById("playBtn").classList.add("visible");
  setQueueStatus(selectedTc
    ? `Ready to play ${TIME_CONTROLS[selectedTc].label} · Click Find Game`
    : "Select a time control to play"
  );

  const pendingClaim = claimAttemptPromise;
  if (pendingClaim) {
    try {
      await pendingClaim;
    } catch (error) {
      console.warn("Match attempt ended during cancellation:", error);
    }
  }

  if (myQueueRef) {
    const queueRef = myQueueRef;
    myQueueRef = null;
    try {
      const { remove } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
      await remove(queueRef);
    } catch (error) {
      console.warn("Could not remove queue entry:", error);
    }
  }
  if (currentGameUnsub) {
    currentGameUnsub();
    currentGameUnsub = null;
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
  if (!currentGameId) return false;
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

  activeTimer = game.turn() === "w" ? "white" : "black";
  renderTimers();

  pushMove();
}

// =======================
// PUSH MOVE TO FIREBASE
// =======================
async function pushMove() {
  if (!currentGameId || !currentWhiteData?.uid || !currentBlackData?.uid) return;

  const history = game.history();
  const oldPly = history.length - 1;
  const san = history[oldPly];
  const nextUid = game.turn() === "w"
    ? currentWhiteData.uid
    : currentBlackData.uid;

  if (oldPly < 0 || !san || !nextUid) return;

  const { ref, update, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const gameRef = ref(window.firebaseDb, `games/${currentGameId}`);

  try {
    await update(gameRef, {
      [`moves/${oldPly}`]: san,
      position: {
        ply: oldPly + 1,
        turnUid: nextUid,
        fen: game.fen(),
        lastMove: san,
      },
    });
  } catch (error) {
    console.warn("Move update rejected; restoring server position:", error);
    try {
      const snap = await get(gameRef);
      if (snap.exists()) syncBoardFromData(snap.val(), true);
    } catch (reloadError) {
      console.error("Could not restore the server position:", reloadError);
    }
  }
}

// =======================
// LISTEN TO GAME
// =======================
let currentWhiteData = null;
let currentBlackData = null;
let timersStarted = false;

function orderedMoves(rawMoves) {
  if (!rawMoves || typeof rawMoves !== "object") return [];
  return Object.entries(rawMoves)
    .sort(([a], [b]) => {
      const aNumber = Number(a);
      const bNumber = Number(b);
      if (Number.isInteger(aNumber) && Number.isInteger(bNumber)) return aNumber - bNumber;
      return a.localeCompare(b);
    })
    .map(([, move]) => move)
    .filter(move => typeof move === "string");
}

function buildLegacyMigration(data, whiteUsername, blackUsername) {
  if (
    !data
    || data.schemaVersion !== undefined
    || data.kind !== undefined
    || data.createdBy !== undefined
    || data.position !== undefined
    || data.clocks !== undefined
    || data.status !== "playing"
    || !data.white?.uid
    || !data.black?.uid
    || data.white.uid === data.black.uid
    || !Number.isFinite(data.createdAt)
  ) {
    throw new Error("This game is not eligible for the legacy migration.");
  }

  const rawMoves = data.moves ?? {};
  if (
    !rawMoves
    || typeof rawMoves !== "object"
    || Array.isArray(rawMoves) && rawMoves.some(move => move == null)
  ) {
    throw new Error("The legacy move history is malformed.");
  }

  const entries = Object.entries(rawMoves)
    .sort(([left], [right]) => Number(left) - Number(right));
  if (
    entries.length > 600
    || entries.some(([key, san], index) =>
      key !== String(index)
      || typeof san !== "string"
      || san.length < 1
      || san.length > 32)
  ) {
    throw new Error("The legacy move history is not contiguous.");
  }

  const replay = new Chess();
  for (const [, san] of entries) {
    let move = null;
    try {
      move = replay.move(san);
    } catch {
      move = null;
    }
    if (!move) throw new Error("The legacy move history contains an illegal move.");
  }

  const ply = entries.length;
  const replayedFen = replay.fen();
  if (
    (ply === 0 && data.fen !== undefined && data.fen !== START_FEN)
    || (ply > 0 && data.fen !== replayedFen)
  ) {
    throw new Error("The legacy position does not match its move history.");
  }

  const hasLegacyTimeControl = Object.prototype.hasOwnProperty.call(data, "timeControl");
  const timeControl = hasLegacyTimeControl ? data.timeControl : "rapid";
  if (!TIME_CONTROLS[timeControl] || (!hasLegacyTimeControl && data.tournamentId)) {
    throw new Error("The legacy time control is invalid.");
  }
  let hasCanonicalChallengeMarker = false;
  if (data.challenge !== undefined) {
    const challengeKeys = data.challenge && typeof data.challenge === "object"
      ? Object.keys(data.challenge).sort()
      : [];
    if (
      challengeKeys.join(",") !== "fromUid,toUid"
      || data.challenge.fromUid !== data.white.uid
      || data.challenge.toUid !== data.black.uid
      || data.tournamentId !== undefined
      || timeControl !== "rapid"
    ) {
      throw new Error("The legacy challenge marker is invalid.");
    }
    hasCanonicalChallengeMarker = true;
  }

  const kind = data.tournamentId
    ? "tournament"
    : hasCanonicalChallengeMarker || !hasLegacyTimeControl
      ? "challenge"
      : "queue";
  const seconds = TIME_CONTROLS[timeControl].seconds;
  const hasWhiteClock = Object.prototype.hasOwnProperty.call(data, "whiteTime");
  const hasBlackClock = Object.prototype.hasOwnProperty.call(data, "blackTime");
  if (hasWhiteClock !== hasBlackClock) {
    throw new Error("Both legacy clocks are required when either clock exists.");
  }
  const legacyClock = color => {
    const key = `${color}Time`;
    if (!Object.prototype.hasOwnProperty.call(data, key)) {
      if (kind === "challenge" && ply === 0) return seconds;
      throw new Error(`The legacy ${color} clock is missing.`);
    }
    const value = data[key];
    if (!Number.isInteger(value) || value < 0 || value > seconds) {
      throw new Error(`The legacy ${color} clock is invalid.`);
    }
    return value;
  };
  const migratedWhiteClock = legacyClock("white");
  const migratedBlackClock = legacyClock("black");
  const millisecondClockKeys = ["whiteTimeMs", "blackTimeMs", "activeColor", "clockUpdatedAt"];
  const millisecondClockCount = millisecondClockKeys
    .filter(key => Object.prototype.hasOwnProperty.call(data, key))
    .length;
  if (millisecondClockCount !== 0 && millisecondClockCount !== millisecondClockKeys.length) {
    throw new Error("The legacy millisecond clock metadata is partial.");
  }
  if (
    millisecondClockCount === millisecondClockKeys.length
    && (
      !Number.isInteger(data.whiteTimeMs)
      || data.whiteTimeMs < 0
      || data.whiteTimeMs > seconds * 1000
      || !Number.isInteger(data.blackTimeMs)
      || data.blackTimeMs < 0
      || data.blackTimeMs > seconds * 1000
      || Math.ceil(data.whiteTimeMs / 1000) !== migratedWhiteClock
      || Math.ceil(data.blackTimeMs / 1000) !== migratedBlackClock
      || data.activeColor !== (replay.turn() === "w" ? "white" : "black")
      || !Number.isFinite(data.clockUpdatedAt)
      || data.clockUpdatedAt < data.createdAt
    )
  ) {
    throw new Error("The legacy millisecond clock metadata is inconsistent.");
  }
  const position = {
    ply,
    turnUid: replay.turn() === "w" ? data.white.uid : data.black.uid,
    fen: ply === 0 ? START_FEN : replayedFen,
  };
  if (ply > 0) position.lastMove = entries[ply - 1][1];

  const updates = {
    schemaVersion: 2,
    kind,
    createdBy: kind === "challenge" ? data.black.uid : data.white.uid,
    position,
    clocks: {
      white: migratedWhiteClock,
      black: migratedBlackClock,
    },
  };
  if (!hasLegacyTimeControl) updates.timeControl = timeControl;
  if (data.white.username !== whiteUsername) updates["white/username"] = whiteUsername;
  if (data.black.username !== blackUsername) updates["black/username"] = blackUsername;
  return updates;
}

async function ensureGameSchema(gameId) {
  const { ref, get, update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;
  const gameRef = ref(db, `games/${gameId}`);
  let gameSnap = await get(gameRef);
  let data = gameSnap.val();
  if (!data || data.schemaVersion === 2) return data;

  const whiteUid = data.white?.uid;
  const blackUid = data.black?.uid;
  const myUid = window.myUid;
  if (!myUid || (myUid !== whiteUid && myUid !== blackUid)) {
    throw new Error("Only a player in this game can migrate it.");
  }

  const [whiteNameSnap, blackNameSnap, myGameSnap] = await Promise.all([
    get(ref(db, `users/${whiteUid}/username`)),
    get(ref(db, `users/${blackUid}/username`)),
    get(ref(db, `users/${myUid}/currentGame`)),
  ]);
  const whiteUsername = whiteNameSnap.val();
  const blackUsername = blackNameSnap.val();
  if (
    typeof whiteUsername !== "string"
    || typeof blackUsername !== "string"
    || myGameSnap.val() !== gameId
  ) {
    throw new Error("The legacy game assignments could not be verified.");
  }

  const migration = buildLegacyMigration(data, whiteUsername, blackUsername);
  try {
    await update(gameRef, migration);
  } catch (error) {
    gameSnap = await get(gameRef);
    data = gameSnap.val();
    if (data?.schemaVersion === 2) return data;
    throw error;
  }

  gameSnap = await get(gameRef);
  data = gameSnap.val();
  if (data?.schemaVersion !== 2) {
    throw new Error("The legacy game migration did not complete.");
  }
  return data;
}

function syncBoardFromData(data, force = false) {
  currentWhiteData = data.white || null;
  currentBlackData = data.black || null;
  if (TIME_CONTROLS[data.timeControl]) currentTimeControl = data.timeControl;

  const remoteMoves = orderedMoves(data.moves);
  const localMoves = game.history();
  const movesDiffer = remoteMoves.length !== localMoves.length
    || remoteMoves.some((move, index) => move !== localMoves[index]);

  if (force || movesDiffer) {
    const priorMoveCount = localMoves.length;
    game.reset();
    let replayedAll = true;

    for (const san of remoteMoves) {
      try {
        if (!game.move(san)) {
          replayedAll = false;
          break;
        }
      } catch {
        replayedAll = false;
        break;
      }
    }

    if (!replayedAll) {
      game.reset();
      const fallbackFen = data.position?.fen || data.fen;
      if (typeof fallbackFen === "string") {
        try {
          game.load(fallbackFen);
        } catch {
          game.reset();
        }
      }
    }

    board.position(game.fen(), true);

    if (remoteMoves.length > priorMoveCount) {
      playSound(soundForMove(
        { captured: game.history({ verbose: true }).at(-1)?.captured },
        game,
      ));
    }
  }

  if (data.position?.turnUid === data.white?.uid) activeTimer = "white";
  else if (data.position?.turnUid === data.black?.uid) activeTimer = "black";
  else activeTimer = game.turn() === "w" ? "white" : "black";

  const defaultTime = TIME_CONTROLS[data.timeControl]?.seconds ?? 600;
  const whiteFallback = timersStarted ? whiteTime : defaultTime;
  const blackFallback = timersStarted ? blackTime : defaultTime;
  whiteTime = readClock(data, "white", whiteFallback);
  blackTime = readClock(data, "black", blackFallback);
  renderTimers();

  return remoteMoves;
}

function listenToGame(gameId) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, onValue }) => {
      const db = window.firebaseDb;

      onValue(ref(db, `games/${gameId}`), (snap) => {
        const data = snap.val();
        if (!data) return;

        syncBoardFromData(data);

        if (!timersStarted && data.timeControl) {
          timersStarted = true;
          startTimers(data);
        }

        updatePlayerBars(data);

        // Detect resign
        if (data.resigned && !gameOverHandled) {
          gameOverHandled = true;
          clearInterval(timerInterval);
          const result = data.resigned === myColor ? "loss" : "win";
          showGameOver(result, "resign");
          saveGameResult(data, result);
          return;
        }

        // Detect draw accepted
        if (data.drawAccepted && !gameOverHandled) {
          gameOverHandled = true;
          clearInterval(timerInterval);
          showGameOver("draw", "draw");
          saveGameResult(data, "draw");
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
          gameOverHandled = true;
          clearInterval(timerInterval);
          let result;
          if (game.in_checkmate()) {
            const loserColor = game.turn() === "w" ? "white" : "black";
            result = myColor === loserColor ? "loss" : "win";
          } else {
            result = "draw";
          }
          showGameOver(result, game.in_checkmate() ? "checkmate" : "draw");
          saveGameResult(data, result);
        }
      });
    });
}

// =======================
// START GAME
// =======================
async function startGame(gameId, color, tc) {
  try {
    const data = await ensureGameSchema(gameId);
    if (!data || data.status !== "playing") {
      throw new Error("This game is no longer active.");
    }
    const verifiedColor = data.white?.uid === window.myUid
      ? "white"
      : data.black?.uid === window.myUid
        ? "black"
        : null;
    if (!verifiedColor) throw new Error("This account is not a player in the game.");
    beginGame(gameId, verifiedColor, data.timeControl || tc);
  } catch (error) {
    console.error("Could not prepare the game:", error);
    setQueueStatus("This older game could not be resumed safely.");
  }
}

function beginGame(gameId, color, tc) {
  if (currentGameUnsub) {
    currentGameUnsub();
    currentGameUnsub = null;
  }
  currentGameId = gameId;
  myColor = color;
  if (TIME_CONTROLS[tc]) currentTimeControl = tc;
  gameOverHandled = false;
  timersStarted = false;
  isQueuing = false;
  clockWriteInFlight = false;
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
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
    onDrop,
    onDragStart,
    onSnapbackEnd: () => clearLegalDots(),
  });

  if (tc) {
    const secs = TIME_CONTROLS[tc]?.seconds ?? 600;
    whiteTime = secs;
    blackTime = secs;
    renderTimers();
  }

  listenToGame(gameId);
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
  gameOverHandled = false;
  timersStarted = false;
  myColor = null;
  clearInterval(timerInterval);
  whiteTime = 0;
  blackTime = 0;
  document.getElementById("whiteTimer").textContent = "—:——";
  document.getElementById("blackTimer").textContent = "—:——";
  game.reset();
  board.destroy();
  board = Chessboard("board", {
    draggable: false,
    position: "start",
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
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
  if (!uid) return { title: null, rating: null, avatar: null };
  const { ref, get } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const [titleSnap, ratingSnap, avatarSnap] = await Promise.all([
    get(ref(window.firebaseDb, `users/${uid}/title`)),
    get(ref(window.firebaseDb, `users/${uid}/rating`)),
    get(ref(window.firebaseDb, `users/${uid}/avatarUrl`)),
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

  let safeUrl = null;
  if (typeof url === "string") {
    try {
      const parsed = new URL(url);
      if (
        parsed.protocol === "https:"
        && parsed.hostname === "res.cloudinary.com"
        && parsed.pathname.startsWith("/dszgbkb1f/image/upload/")
      ) {
        safeUrl = parsed.href;
      }
    } catch {
      safeUrl = null;
    }
  }

  if (safeUrl) {
    el.style.backgroundImage = `url("${safeUrl}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.fontSize = "0";
    el.textContent = "";
  } else {
    el.style.backgroundImage = "";
    el.style.fontSize = "";
    el.textContent = letter;
  }
}

function renderPlayerName(el, titleKey, username, showYou = false) {
  if (!el) return;
  el.replaceChildren();

  const title = titleKey && TITLE_LABELS[titleKey];
  if (title) {
    const badge = document.createElement("span");
    badge.className = "bar-title";
    badge.style.color = title.color;
    badge.textContent = title.label;
    el.append(badge, document.createTextNode(" "));
  }

  el.append(document.createTextNode(String(username || "Unknown")));

  if (showYou) {
    const you = document.createElement("span");
    you.className = "bar-you";
    el.append(document.createTextNode(" "), you);
  }
}

async function updatePlayerBars(data) {
  const whiteUsername = data.white?.username || "White";
  const blackUsername = data.black?.username || "Black";
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
  const myAvatarId = myColor === "white" ? "whiteAvatar" : "blackAvatar";
  const oppAvatarId = myColor === "white" ? "blackAvatar" : "whiteAvatar";

  // Bottom bar = you, top bar = opponent
  const bottomName = document.getElementById("whiteName");
  const bottomRating = document.getElementById("whiteRating");
  const topName = document.getElementById("blackName");
  const topRating = document.getElementById("blackRating");

  setAvatar("whiteAvatar", myData.avatar, String(myUsername || "?")[0].toUpperCase());
  setAvatar("blackAvatar", oppData.avatar, String(oppUsername || "?")[0].toUpperCase());

  renderPlayerName(bottomName, myData.title, myUsername, true);
  if (bottomRating) bottomRating.textContent = myData.rating ? `(${myData.rating})` : "";
  renderPlayerName(topName, oppData.title, oppUsername);
  if (topRating) topRating.textContent = oppData.rating ? `(${oppData.rating})` : "";
}

// =======================
// SAVE GAME RESULT
// =======================
async function saveGameResult(data, result) {
  const { ref, get, update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;
  const myUid = window.myUid;
  if (!myUid || !currentGameId) return;

  const opponentData = myColor === "white" ? data.black : data.white;
  const opponentUsername = opponentData?.username || "Unknown";
  const statsField = result === "win" ? "wins" : result === "loss" ? "losses" : "draws";

  const [statSnap, ratingSnap] = await Promise.all([
    get(ref(db, `users/${myUid}/${statsField}`)),
    get(ref(db, `users/${myUid}/rating`)),
  ]);

  const currentStat = Number.isInteger(statSnap.val()) ? statSnap.val() : 0;
  const currentRating = Number.isFinite(ratingSnap.val()) ? ratingSnap.val() : 1200;
  const newStat = currentStat + 1;
  const requestedRatingChange = result === "win" ? 10 : result === "loss" ? -10 : 0;
  const newRating = Math.min(4000, Math.max(100, currentRating + requestedRatingChange));
  const ratingChange = newRating - currentRating;

  await update(ref(db), {
    [`users/${myUid}/${statsField}`]: newStat,
    [`users/${myUid}/rating`]: newRating,
    [`users/${myUid}/currentGame`]: null,
    [`games/${currentGameId}/status`]: "finished",
    [`users/${myUid}/gameHistory/${currentGameId}`]: {
      gameId: currentGameId,
      result,
      opponentUsername,
      myColor,
      moveCount: game.history().length,
      playedAt: Date.now(),
      ratingChange,
      timeControl: data.timeControl || currentTimeControl || selectedTc || "rapid",
    },
  });

  if (currentTournamentId) await saveTournamentResult(result);
}

// =======================
// SAVE TOURNAMENT RESULT
// =======================
async function saveTournamentResult(result) {
  const { ref, runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const myUid = window.myUid;
  if (!myUid || !currentTournamentId) return;

  const scoreGain = result === "win" ? 2 : result === "draw" ? 1 : 0;

  await runTransaction(ref(window.firebaseDb, `tournaments/${currentTournamentId}/players/${myUid}`), player => {
    if (!player) return player;
    return {
      username:    player.username,
      score:       (player.score       || 0) + scoreGain,
      wins:        (player.wins        || 0) + (result === "win"  ? 1 : 0),
      draws:       (player.draws       || 0) + (result === "draw" ? 1 : 0),
      losses:      (player.losses      || 0) + (result === "loss" ? 1 : 0),
      gamesPlayed: (player.gamesPlayed || 0) + 1,
      joinedAt:    player.joinedAt,
    };
  });
}

// =======================
// WAIT FOR FIREBASE
// =======================
function waitForFirebase(cb) {
  if (window.firebaseDb && window.firebaseAuth) return cb();
  setTimeout(() => waitForFirebase(cb), 50);
}

// =======================
// QUEUE
// =======================
function openQueueEntry(uid, username, joinedAt, tc) {
  return { uid, username, joinedAt, tc, state: "open" };
}

function isEarlierQueueEntry(candidate, mine) {
  return candidate.joinedAt < mine.joinedAt
    || (candidate.joinedAt === mine.joinedAt && candidate.uid < mine.uid);
}

function isFreshQueueTimestamp(value, referenceTime = Date.now()) {
  return Number.isFinite(value)
    && value >= referenceTime - 300000
    && value <= referenceTime + 300000;
}

async function reopenClaim(entryRef, expectedState, peerUid, gameId, openEntry) {
  const { runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  await runTransaction(entryRef, current => {
    if (
      !current
      || current.state !== expectedState
      || current.peerUid !== peerUid
      || current.gameId !== gameId
    ) {
      return;
    }
    return openEntry;
  });
}

async function rollbackClaims(
  ownRef,
  candidateRef,
  ownOpen,
  candidateOpen,
  candidateUid,
  gameId,
) {
  // The peer lock is released first so a failed creator cannot strand it.
  try {
    await reopenClaim(candidateRef, "claimed", ownOpen.uid, gameId, candidateOpen);
  } catch (error) {
    console.warn("Could not release opponent queue claim:", error);
  }

  try {
    await reopenClaim(ownRef, "claiming", candidateUid, gameId, ownOpen);
  } catch (error) {
    console.warn("Could not release own queue claim:", error);
  }
}

async function joinQueue(uid, username, tc) {
  const { ref, set, onDisconnect, runTransaction } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;
  const joinedAt = Date.now();
  const entry = openQueueEntry(uid, username, joinedAt, tc);

  myQueueRef = ref(db, `queue/${tc}/${uid}`);

  try {
    const cleanup = await runTransaction(myQueueRef, current => {
      if (!current) return null;
      if (
        current.uid === uid
        && (current.state === undefined || current.state === "open")
      ) {
        return null;
      }
      return;
    }, { applyLocally: false });
    if (!cleanup.committed) {
      throw new Error("A previous matchmaking claim is still being resolved.");
    }

    const disconnect = onDisconnect(myQueueRef);
    await disconnect.remove();
    await set(myQueueRef, entry);
    const attempt = tryMatch(uid, username, tc);
    claimAttemptPromise = attempt;
    let matched;
    try {
      matched = await attempt;
    } finally {
      if (claimAttemptPromise === attempt) claimAttemptPromise = null;
    }
    if (!matched && isQueuing) listenForGame(uid, tc);
  } catch (error) {
    console.error("Could not join the matchmaking queue:", error);
    await cancelQueue();
    setQueueStatus("Could not join the queue. Please try again.");
  }
}

async function tryMatch(myUid, myUsername, tc) {
  if (claimInFlight) return false;
  claimInFlight = true;

  const {
    ref,
    get,
    push,
    runTransaction,
    remove,
  } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;
  const ownRef = ref(db, `queue/${tc}/${myUid}`);
  const queueRef = ref(db, `queue/${tc}`);

  try {
    for (let attempt = 0; attempt < 5 && isQueuing; attempt++) {
      const [ownSnap, queueSnap] = await Promise.all([get(ownRef), get(queueRef)]);
      const mine = ownSnap.val();
      const queueWindowNow = Date.now();

      if (
        !mine
        || mine.state !== "open"
        || !isFreshQueueTimestamp(mine.joinedAt, queueWindowNow)
      ) {
        return false;
      }

      const candidates = [];
      queueSnap.forEach(child => {
        const candidate = child.val();
        if (
          candidate
          && candidate.uid === child.key
          && candidate.uid !== myUid
          && candidate.tc === tc
          && candidate.state === "open"
          && typeof candidate.username === "string"
          && isFreshQueueTimestamp(candidate.joinedAt, queueWindowNow)
          && isEarlierQueueEntry(candidate, mine)
        ) {
          candidates.push(candidate);
        }
      });

      candidates.sort((a, b) =>
        a.joinedAt - b.joinedAt || a.uid.localeCompare(b.uid));
      const candidate = candidates[0];
      if (!candidate) return false;

      const gameId = push(ref(db, "games")).key;
      if (!gameId) throw new Error("Could not reserve a game ID.");

      const stateAt = Date.now();
      const ownOpen = openQueueEntry(myUid, myUsername, mine.joinedAt, tc);
      const candidateOpen = openQueueEntry(
        candidate.uid,
        candidate.username,
        candidate.joinedAt,
        tc,
      );
      const candidateRef = ref(db, `queue/${tc}/${candidate.uid}`);

      const ownLock = await runTransaction(ownRef, current => {
        if (
          !current
          || current.state !== "open"
          || current.uid !== myUid
          || current.username !== myUsername
          || current.joinedAt !== mine.joinedAt
          || current.tc !== tc
        ) {
          return;
        }
        return {
          ...ownOpen,
          state: "claiming",
          peerUid: candidate.uid,
          gameId,
          stateAt,
        };
      });

      if (!ownLock.committed) return false;

      let candidateLock;
      try {
        candidateLock = await runTransaction(candidateRef, current => {
          if (
            !current
            || current.state !== "open"
            || current.uid !== candidate.uid
            || current.username !== candidate.username
            || current.joinedAt !== candidate.joinedAt
            || current.tc !== tc
          ) {
            return;
          }
          return {
            ...candidateOpen,
            state: "claimed",
            peerUid: myUid,
            gameId,
            stateAt: Date.now(),
          };
        });
      } catch (error) {
        await reopenClaim(ownRef, "claiming", candidate.uid, gameId, ownOpen);
        throw error;
      }

      if (!candidateLock.committed) {
        await reopenClaim(ownRef, "claiming", candidate.uid, gameId, ownOpen);
        continue;
      }

      if (!isQueuing) {
        await rollbackClaims(
          ownRef,
          candidateRef,
          ownOpen,
          candidateOpen,
          candidate.uid,
          gameId,
        );
        return false;
      }

      try {
        await createGame(
          gameId,
          myUid,
          myUsername,
          candidate.uid,
          candidate.username,
          tc,
        );
      } catch (error) {
        try {
          await remove(ref(db, `games/${gameId}`));
        } catch (cleanupError) {
          console.warn("Could not remove an unstarted game:", cleanupError);
        }
        await rollbackClaims(
          ownRef,
          candidateRef,
          ownOpen,
          candidateOpen,
          candidate.uid,
          gameId,
        );
        throw error;
      }

      isQueuing = false;
      claimInFlight = false;

      const cleanup = await Promise.allSettled([
        remove(candidateRef),
        remove(ownRef),
      ]);
      cleanup.forEach(result => {
        if (result.status === "rejected") {
          console.warn("Matched queue entry cleanup failed:", result.reason);
        }
      });
      myQueueRef = null;
      startGame(gameId, "white", tc);
      return true;
    }

    return false;
  } finally {
    claimInFlight = false;
  }
}

async function createGame(gameId, whiteUid, whiteUsername, blackUid, blackUsername, tc) {
  const { ref, set, update } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;
  const secs = TIME_CONTROLS[tc]?.seconds ?? 600;

  await set(ref(db, `games/${gameId}`), {
    schemaVersion: 2,
    kind: "queue",
    createdBy: whiteUid,
    white: { uid: whiteUid, username: whiteUsername },
    black: { uid: blackUid, username: blackUsername },
    status: "playing",
    timeControl: tc,
    createdAt: Date.now(),
    position: {
      ply: 0,
      turnUid: whiteUid,
      fen: START_FEN,
    },
    clocks: {
      white: secs,
      black: secs,
    },
  });

  await update(ref(db), {
    [`users/${whiteUid}/currentGame`]: gameId,
    [`users/${blackUid}/currentGame`]: gameId,
  });
}

async function listenForGame(uid, tc) {
  const { ref, onValue, get, remove } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;

  if (currentGameUnsub) currentGameUnsub();
  currentGameUnsub = onValue(ref(db, `users/${uid}/currentGame`), async snap => {
    if (!snap.exists() || currentGameId || claimInFlight) return;

    const gameId = snap.val();
    try {
      const gameSnap = await get(ref(db, `games/${gameId}`));
      const gameData = gameSnap.val();
      if (
        !gameData
        || gameData.status !== "playing"
        || (gameData.white?.uid !== uid && gameData.black?.uid !== uid)
      ) {
        return;
      }

      if (currentGameUnsub) {
        currentGameUnsub();
        currentGameUnsub = null;
      }
      if (myQueueRef) {
        try {
          await remove(myQueueRef);
        } catch (error) {
          console.warn("Could not clean up queue entry:", error);
        }
        myQueueRef = null;
      }

      isQueuing = false;
      const color = gameData.white?.uid === uid ? "white" : "black";
      startGame(gameId, color, gameData.timeControl || tc);
    } catch (error) {
      console.error("Could not open the matched game:", error);
    }
  });
}

// =======================
// RESIGN + DRAW
// =======================
document.getElementById("resignBtn").onclick = () => {
  if (!currentGameId || gameOverHandled) return;
  if (!confirm("Are you sure you want to resign?")) return;
  handleResign();
};

async function handleResign() {
  if (gameOverHandled) return;
  gameOverHandled = true;
  clearInterval(timerInterval);

  const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  await set(ref(window.firebaseDb, `games/${currentGameId}/resigned`), myColor);

  showGameOver("loss", "resign");
  saveGameResult({ white: currentWhiteData, black: currentBlackData }, "loss");
}

document.getElementById("drawOfferBtn").onclick = async () => {
  if (!currentGameId || gameOverHandled) return;
  const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  await set(ref(window.firebaseDb, `games/${currentGameId}/drawOffer`), myColor);
  const msg = document.getElementById("drawOfferMsg");
  msg.textContent = "Draw offer sent...";
  msg.style.color = "var(--accent)";
  document.getElementById("drawOfferBtn").disabled = true;
};

document.getElementById("acceptDrawBtn").onclick = async () => {
  if (!currentGameId || gameOverHandled) return;
  gameOverHandled = true;
  clearInterval(timerInterval);

  const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  await set(ref(window.firebaseDb, `games/${currentGameId}/drawAccepted`), true);

  showGameOver("draw", "draw");
  saveGameResult({ white: currentWhiteData, black: currentBlackData }, "draw");
};

document.getElementById("declineDrawBtn").onclick = async () => {
  const { ref, set } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  await set(ref(window.firebaseDb, `games/${currentGameId}/drawOffer`), null);
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
  const uid = window.myUid;
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


waitForFirebase(() => {
  window.firebaseOnAuthChanged(window.firebaseAuth, user => {
    if (!user) { window.location.href = "login.html"; return; }

    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
      .then(({ ref, get }) => {
        get(ref(window.firebaseDb, `users/${user.uid}/username`)).then(snap => {
          const username = snap.val() || user.email;
          window.myUid = user.uid;
          window.myUsername = username;
          loadMyAvatar();

          const params        = new URLSearchParams(window.location.search);
          const challengeId   = params.get("challenge");
          const colorParam    = params.get("color");
          currentTournamentId = params.get("tournament") || null;

          if (currentTournamentId) {
            window.history.replaceState({}, "", "play.html");
            const goArenaBtn = document.getElementById("goArena");
            const goAgainBtn = document.getElementById("goPlayAgain");
            if (goArenaBtn) goArenaBtn.classList.remove("hidden");
            if (goAgainBtn) goAgainBtn.classList.add("hidden");
          }

          if (challengeId && colorParam) {
            window.history.replaceState({}, "", "play.html");
            startGame(challengeId, colorParam, null);
            return;
          }

          get(ref(window.firebaseDb, `users/${user.uid}/currentGame`)).then(gameSnap => {
            if (gameSnap.exists()) {
              const gameId = gameSnap.val();
              get(ref(window.firebaseDb, `games/${gameId}`)).then(gSnap => {
                const gameData = gSnap.val();
                if (!gameData || gameData.status !== "playing") return;
                const color = gameData.white?.uid === user.uid ? "white" : "black";
                startGame(gameId, color, gameData.timeControl);
              });
            }
          });
        });
      });
  });
});
