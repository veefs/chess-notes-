const settings = window.getSettings ? window.getSettings() : {};

// =======================
// BOARD + GAME
// =======================
const boardEl = document.getElementById("board");
if (!boardEl) throw new Error("No #board element found");

const game = new Chess();
let board = Chessboard("board", {
  draggable: true,
  moveSpeed: 200,
  snapSpeed: 150,
  snapbackSpeed: 200,
  position: "start",
  pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
  onDrop: onDrop,
  onDragStart: onDragStart,
  onSnapbackEnd: () => clearLegalDots(),
});

let myColor = null;
let currentGameId = null;
let gameOverHandled = false;

// =======================
// DRAG GUARDS
// =======================
function onDragStart(source, piece) {
  if (!currentGameId) return false;
  if (myColor === "white" && game.turn() !== "w") return false;
  if (myColor === "black" && game.turn() !== "b") return false;

  const settings = window.getSettings ? window.getSettings() : {};
  if (settings.legalMoves) {
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
    });
}

// =======================
// LISTEN TO GAME
// =======================
function listenToGame(gameId) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, onValue }) => {
      const db = window.firebaseDb;

      onValue(ref(db, `games/${gameId}`), (snap) => {
        const data = snap.val();
        if (!data) return;

        const remoteMoves = data.moves ? Object.values(data.moves) : [];
        const localMoves  = game.history();

        if (remoteMoves.length !== localMoves.length) {
          game.reset();
          for (const san of remoteMoves) game.move(san);
          board.position(game.fen(), true);
          playSound(soundForMove({ captured: game.history({ verbose: true }).at(-1)?.captured }, game));
        }

        updatePlayerBars(data);

        if (game.game_over() && !gameOverHandled) {
          gameOverHandled = true;
          saveGameResult(data);
        }
      });
    });
}

// =======================
// START GAME
// =======================
function startGame(gameId, color) {
  currentGameId = gameId;
  myColor       = color;

  board.destroy();
  board = Chessboard("board", {
    position: "start",
    draggable: true,
    orientation: color,
    pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
    onDrop,
    onDragStart,
  });

  console.log(`🎮 Game started | ID: ${gameId} | Playing as: ${color}`);
  listenToGame(gameId);
}

// =======================
// PLAYER BARS
// =======================
const TITLE_LABELS = {
  dev: { label: "DEV", color: "#74ebcb" },
  gm:  { label: "GM",           color: "#f0c040" },
  im:  { label: "IM",           color: "#aaaaaa" },
  fm:  { label: "FM",           color: "#d4956a" },
  cm:  { label: "CM",           color: "#7ecf7e" },
  nm:  { label: "NM",           color: "#7ab8e0" },
  mod: { label: "Mod",          color: "#f08080" },
};

const titleCache = {};

async function fetchTitle(uid) {
  if (titleCache[uid] !== undefined) return titleCache[uid];
  return import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, get }) => get(ref(window.firebaseDb, `users/${uid}/title`)))
    .then(snap => { titleCache[uid] = snap.val() || null; return titleCache[uid]; });
}

function titleTag(key) {
  const t = key && TITLE_LABELS[key];
  if (!t) return "";
  return `&nbsp;<span style="font-size:11px;font-weight:700;color:${t.color};letter-spacing:.5px;">${t.label}</span>`;
}

async function updatePlayerBars(data) {
  const topBar    = document.getElementById("black-bar");
  const bottomBar = document.getElementById("white-bar");
  if (!topBar || !bottomBar) return;

  const whiteUsername = data.white?.username || "White";
  const blackUsername = data.black?.username || "Black";
  const whiteUid      = data.white?.uid;
  const blackUid      = data.black?.uid;

  const [whiteTitle, blackTitle] = await Promise.all([
    whiteUid ? fetchTitle(whiteUid) : null,
    blackUid ? fetchTitle(blackUid) : null,
  ]);

  if (myColor === "white") {
    bottomBar.innerHTML = `⚪ ${whiteUsername}${titleTag(whiteTitle)} <span style="color:var(--muted);font-size:11px;">(You)</span>`;
    topBar.innerHTML    = `⚫ ${blackUsername}${titleTag(blackTitle)}`;
  } else {
    bottomBar.innerHTML = `⚫ ${blackUsername}${titleTag(blackTitle)} <span style="color:var(--muted);font-size:11px;">(You)</span>`;
    topBar.innerHTML    = `⚪ ${whiteUsername}${titleTag(whiteTitle)}`;
  }
}

// =======================
// GAME OVER
// =======================
function getGameOverMessage() {
  if (game.in_checkmate()) return `Checkmate! ${game.turn() === "w" ? "Black" : "White"} wins!`;
  if (game.in_stalemate()) return "Stalemate!";
  if (game.in_draw())      return "Draw!";
  return "Game over!";
}

async function saveGameResult(data) {
  const { ref, set, get, push } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;
  const myUid = window.myUid;
  if (!myUid) return;

  let result;
  if (game.in_checkmate()) {
    const loserColor = game.turn() === "w" ? "white" : "black";
    result = myColor === loserColor ? "loss" : "win";
  } else {
    result = "draw";
  }

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
    set(ref(db, `users/${myUid}/gameHistory/${historyKey}`), {
      result,
      opponentUsername,
      myColor,
      moveCount: game.history().length,
      playedAt: Date.now(),
      ratingChange,
    }),
    set(ref(db, `games/${currentGameId}/status`), "finished"),
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
function joinQueue(uid, username) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set, remove, onDisconnect }) => {
      const db = window.firebaseDb;

      const myQueueRef = ref(db, `queue/${uid}`);
      set(myQueueRef, { uid, username, joinedAt: Date.now() });
      onDisconnect(myQueueRef).remove();

      console.log("🔍 In queue, looking for opponent...");
      tryMatch(uid, username);
    });
}

function tryMatch(myUid, myUsername) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, runTransaction }) => {
      const db       = window.firebaseDb;
      const queueRef = ref(db, "queue");

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
          console.log("✅ Matched with:", matchedOpponent.username);
          createGame(myUid, myUsername, matchedOpponent.uid, matchedOpponent.username);
        } else {
          console.log("⏳ Waiting for opponent...");
          listenForGame(myUid);
        }
      });
    });
}

function createGame(whiteUid, whiteUsername, blackUid, blackUsername) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set, push }) => {
      const db      = window.firebaseDb;
      const gameRef = push(ref(db, "games"));
      const gameId  = gameRef.key;

      set(gameRef, {
        white: { uid: whiteUid, username: whiteUsername },
        black: { uid: blackUid, username: blackUsername },
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        moves: [],
        status: "playing",
        createdAt: Date.now(),
      });

      set(ref(db, `users/${whiteUid}/currentGame`), gameId);
      set(ref(db, `users/${blackUid}/currentGame`), gameId);

      console.log("✅ Game created:", gameId);
      startGame(gameId, "white");
    });
}

function listenForGame(uid) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, onValue }) => {
      const db = window.firebaseDb;
      console.log("👂 Listening for game assignment...");

      const unsub = onValue(ref(db, `users/${uid}/currentGame`), (snap) => {
        if (snap.exists() && !currentGameId) {
          const gameId = snap.val();
          console.log("🎮 Game assigned:", gameId);
          unsub();
          startGame(gameId, "black");
        }
      });
    });
}

// =======================
// SOUND SYSTEM
// =======================
const sounds = {
  move:    new Audio("sounds/move-self.mp3"),
  capture: new Audio("sounds/capture.mp3"),
  check:   new Audio("sounds/move-check.mp3"),
};

function playSound(name) {
  if (!settings.sound) return;
  const s = sounds[name];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => { });
}

function soundForMove(move, chessGame) {
  if (chessGame.in_check()) return "check";
  if (move.captured)        return "capture";
  return "move";
}

// =======================
// INIT
// =======================
waitForFirebase(() => {
  window.firebaseOnAuthChanged(window.firebaseAuth, user => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    console.log("✅ Logged in as:", user.uid);

    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
      .then(({ ref, get }) => {
        get(ref(window.firebaseDb, `users/${user.uid}/username`)).then(snap => {
          const username = snap.val() || user.email;
          window.myUid      = user.uid;
          window.myUsername = username;

          // ── Check for challenge redirect first ─────────────────────────
          const params      = new URLSearchParams(window.location.search);
          const challengeId = params.get("challenge");
          const colorParam  = params.get("color");

          if (challengeId && colorParam) {
            // Came from a challenge accept/redirect — jump straight in
            console.log(`⚔ Joining challenge game: ${challengeId} as ${colorParam}`);
            // Clean up URL without reloading
            window.history.replaceState({}, "", "play.html");
            startGame(challengeId, colorParam);
            return;
          }

          // ── Check for existing normal game ─────────────────────────────
          get(ref(window.firebaseDb, `users/${user.uid}/currentGame`)).then(gameSnap => {
            if (gameSnap.exists()) {
              const gameId = gameSnap.val();

              get(ref(window.firebaseDb, `games/${gameId}`)).then(gSnap => {
                const gameData = gSnap.val();
                if (!gameData || gameData.status !== "playing") {
                  joinQueue(user.uid, username);
                  return;
                }
                const color = gameData.white?.uid === user.uid ? "white" : "black";
                console.log("🔄 Rejoining existing game:", gameId);
                startGame(gameId, color);
              });
            } else {
              joinQueue(user.uid, username);
            }
          });
        });
      });
  });
});