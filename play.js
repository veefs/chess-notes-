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
  pieceTheme: `pieces/${pieceSet}/{piece}.svg`,
});

let myColor = null;
let currentGameId = null;
let gameOverHandled = false;

// =======================
// TIMERS
// =======================
let whiteTime = 0;
let blackTime = 0;
let timerInterval = null;
let activeTimer = null;

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

  activeTimer = game.turn() === "w" ? "white" : "black";

  whiteTime = data.whiteTime ?? TIME_CONTROLS[data.timeControl]?.seconds ?? 600;
  blackTime = data.blackTime ?? TIME_CONTROLS[data.timeControl]?.seconds ?? 600;

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

function pushTimes() {
  if (!currentGameId) return;
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set }) => {
      set(ref(window.firebaseDb, `games/${currentGameId}/whiteTime`), whiteTime);
      set(ref(window.firebaseDb, `games/${currentGameId}/blackTime`), blackTime);
    });
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
  cancelQueue();
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
function pushMove() {
  if (!currentGameId) return;
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set }) => {
      const db = window.firebaseDb;
      set(ref(db, `games/${currentGameId}/moves`), game.history());
      set(ref(db, `games/${currentGameId}/fen`), game.fen());
      set(ref(db, `games/${currentGameId}/whiteTime`), whiteTime);
      set(ref(db, `games/${currentGameId}/blackTime`), blackTime);
    });
}

// =======================
// LISTEN TO GAME
// =======================
let currentWhiteData = null;
let currentBlackData = null;
let timersStarted = false;

function listenToGame(gameId) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, onValue }) => {
      const db = window.firebaseDb;

      onValue(ref(db, `games/${gameId}`), (snap) => {
        const data = snap.val();
        if (!data) return;

        currentWhiteData = data.white;
        currentBlackData = data.black;

        const remoteMoves = data.moves ? Object.values(data.moves) : [];
        const localMoves = game.history();

        if (remoteMoves.length !== localMoves.length) {
          game.reset();
          for (const san of remoteMoves) game.move(san);
          board.position(game.fen(), true);
          playSound(soundForMove(
            { captured: game.history({ verbose: true }).at(-1)?.captured }, game
          ));

          activeTimer = game.turn() === "w" ? "white" : "black";

          if (data.whiteTime !== undefined) whiteTime = data.whiteTime;
          if (data.blackTime !== undefined) blackTime = data.blackTime;
          renderTimers();
        }

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
function startGame(gameId, color, tc) {
  currentGameId = gameId;
  myColor = color;
  gameOverHandled = false;
  timersStarted = false;
  isQueuing = false;

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
  if (url) {
    el.style.backgroundImage = `url(${url})`;
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

async function updatePlayerBars(data) {
  const whiteUsername = data.white?.username || "White";
  const blackUsername = data.black?.username || "Black";
  const whiteUid = data.white?.uid;
  const blackUid = data.black?.uid;

  const [wData, bData] = await Promise.all([
    fetchUserData(whiteUid),
    fetchUserData(blackUid),
  ]);

  const titleTag = (key) => {
    const t = key && TITLE_LABELS[key];
    return t ? `<span class="bar-title" style="color:${t.color}">${t.label}</span> ` : "";
  };

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

  setAvatar("whiteAvatar", myData.avatar, myUsername[0].toUpperCase());
  setAvatar("blackAvatar", oppData.avatar, oppUsername[0].toUpperCase());

  if (bottomName) bottomName.innerHTML = `${titleTag(myData.title)}${myUsername} <span class="bar-you"></span>`;
  if (bottomRating) bottomRating.textContent = myData.rating ? `(${myData.rating})` : "";
  if (topName) topName.innerHTML = `${titleTag(oppData.title)}${oppUsername}`;
  if (topRating) topRating.textContent = oppData.rating ? `(${oppData.rating})` : "";
}

// =======================
// SAVE GAME RESULT
// =======================
async function saveGameResult(data, result) {
  const { ref, set, get, push } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;
  const myUid = window.myUid;
  if (!myUid) return;

  const opponentData = myColor === "white" ? data.black : data.white;
  const opponentUsername = opponentData?.username || "Unknown";
  const ratingChange = result === "win" ? 10 : result === "loss" ? -10 : 0;
  const statsField = result === "win" ? "wins" : result === "loss" ? "losses" : "draws";

  const [statSnap, ratingSnap] = await Promise.all([
    get(ref(db, `users/${myUid}/${statsField}`)),
    get(ref(db, `users/${myUid}/rating`)),
  ]);

  const newStat = (statSnap.val() ?? 0) + 1;
  const newRating = Math.max(100, (ratingSnap.val() ?? 800) + ratingChange);
  const historyKey = push(ref(db, `users/${myUid}/gameHistory`)).key;

  await Promise.all([
    set(ref(db, `users/${myUid}/${statsField}`), newStat),
    set(ref(db, `users/${myUid}/rating`), newRating),
    set(ref(db, `users/${myUid}/currentGame`), null),
    set(ref(db, `games/${currentGameId}/status`), "finished"),
    set(ref(db, `users/${myUid}/gameHistory/${historyKey}`), {
      gameId: currentGameId,
      result,
      opponentUsername,
      myColor,
      moveCount: game.history().length,
      playedAt: Date.now(),
      ratingChange,
      gameId: currentGameId,
      timeControl: data.timeControl || selectedTc || "rapid",
    }),
  ]);
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
function joinQueue(uid, username, tc) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set, onDisconnect }) => {
      const db = window.firebaseDb;
      myQueueRef = ref(db, `queue/${tc}/${uid}`);
      set(myQueueRef, { uid, username, joinedAt: Date.now(), tc });
      onDisconnect(myQueueRef).remove();
      tryMatch(uid, username, tc);
    });
}

function tryMatch(myUid, myUsername, tc) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, runTransaction }) => {
      const db = window.firebaseDb;
      const queueRef = ref(db, `queue/${tc}`);
      let matchedOpponent = null;

      runTransaction(queueRef, (queue) => {
        if (!queue) return queue;
        const entries = Object.values(queue).filter(e => e.uid !== myUid);
        if (entries.length === 0) return queue;
        entries.sort((a, b) => a.joinedAt - b.joinedAt);
        matchedOpponent = entries[0];
        delete queue[myUid];
        delete queue[matchedOpponent.uid];
        return queue;
      }).then((result) => {
        if (!result.committed) return;
        if (matchedOpponent) {
          createGame(myUid, myUsername, matchedOpponent.uid, matchedOpponent.username, tc);
        } else {
          listenForGame(myUid, tc);
        }
      });
    });
}

function createGame(whiteUid, whiteUsername, blackUid, blackUsername, tc) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set, push }) => {
      const db = window.firebaseDb;
      const gameRef = push(ref(db, "games"));
      const gameId = gameRef.key;
      const secs = TIME_CONTROLS[tc]?.seconds ?? 600;

      set(gameRef, {
        white: { uid: whiteUid, username: whiteUsername },
        black: { uid: blackUid, username: blackUsername },
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        moves: [],
        status: "playing",
        timeControl: tc,
        whiteTime: secs,
        blackTime: secs,
        createdAt: Date.now(),
      });

      set(ref(db, `users/${whiteUid}/currentGame`), gameId);
      set(ref(db, `users/${blackUid}/currentGame`), gameId);
      startGame(gameId, "white", tc);
    });
}

function listenForGame(uid, tc) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, onValue }) => {
      const db = window.firebaseDb;
      const unsub = onValue(ref(db, `users/${uid}/currentGame`), (snap) => {
        if (snap.exists() && !currentGameId) {
          const gameId = snap.val();
          unsub();
          startGame(gameId, "black", tc);
        }
      });
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

          const params = new URLSearchParams(window.location.search);
          const challengeId = params.get("challenge");
          const colorParam = params.get("color");

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