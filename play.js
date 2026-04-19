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

// =======================
// DRAG GUARDS
// =======================
function onDragStart(source, piece) {
  if (!currentGameId) return false;
  // Only allow moving your own pieces on your turn
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
  board.position(game.fen(), false); // ← false = no animation for your own move
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

        // Sync moves from remote
        const remoteMoves = data.moves ? Object.values(data.moves) : [];
        const localMoves = game.history();

        if (remoteMoves.length !== localMoves.length) {
          game.reset();
          for (const san of remoteMoves) game.move(san);
          board.position(game.fen(), true); // ← true = animate opponent's move
          playSound(soundForMove({ captured: game.history({ verbose: true }).at(-1)?.captured }, game));
        }

        // Update player bars
        updatePlayerBars(data);

        if (game.game_over()) {
          console.log("🏁 Game over:", getGameOverMessage());
        }
      });
    });
}

// =======================
// START GAME (called after match found)
// =======================
function startGame(gameId, color) {
  currentGameId = gameId;
  myColor = color;

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
function updatePlayerBars(data) {
  const topBar = document.getElementById("black-bar");
  const bottomBar = document.getElementById("white-bar");
  if (!topBar || !bottomBar) return;

  const whiteUsername = data.white?.username || "White";
  const blackUsername = data.black?.username || "Black";

  if (myColor === "white") {
    bottomBar.textContent = `⚪ ${whiteUsername} (You)`;
    topBar.textContent = `⚫ ${blackUsername}`;
  } else {
    bottomBar.textContent = `⚫ ${blackUsername} (You)`;
    topBar.textContent = `⚪ ${whiteUsername}`;
  }
}

// =======================
// GAME OVER
// =======================
function getGameOverMessage() {
  if (game.in_checkmate()) return `Checkmate! ${game.turn() === "w" ? "Black" : "White"} wins!`;
  if (game.in_stalemate()) return "Stalemate!";
  if (game.in_draw()) return "Draw!";
  return "Game over!";
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

      remove(ref(db, `users/${uid}/currentGame`));

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
      const db = window.firebaseDb;
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
          // We are the matcher — start as white directly, don't listenForGame
          console.log("✅ Matched with:", matchedOpponent.username);
          createGame(myUid, myUsername, matchedOpponent.uid, matchedOpponent.username);
        } else {
          // No one in queue — we are the waiter, listen for assignment
          console.log("⏳ Waiting for opponent...");
          listenForGame(myUid);
        }
      });
    });
}

function createGame(whiteUid, whiteUsername, blackUid, blackUsername) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set, push }) => {
      const db = window.firebaseDb;
      const gameRef = push(ref(db, "games"));
      const gameId = gameRef.key;

      set(gameRef, {
        white: { uid: whiteUid, username: whiteUsername },
        black: { uid: blackUid, username: blackUsername },
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        moves: [],
        status: "playing",
        createdAt: Date.now(),
      });

      // Tell both players their game ID
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
  move: new Audio("sounds/move-self.mp3"),
  capture: new Audio("sounds/capture.mp3"),
  check: new Audio("sounds/move-check.mp3"),
};

function playSound(name) {
  if(!settings.sound) return;

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
          window.myUid = user.uid;
          window.myUsername = username;
          console.log("👤 Username:", username);
          joinQueue(user.uid, username);
        });
      });
  });
});