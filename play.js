const boardEl = document.getElementById("board");

if (!boardEl) {
  alert("❌ Missing #board element");
  throw new Error("No board element found");
}

const game = new Chess();

const board = Chessboard("board", {
  position: "start",
  draggable: false,
  pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
});

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
  const db = window.firebaseDb;
  const ref = window.firebaseRef;
  const set = window.firebaseSet;

  // Write yourself into the queue
  const myQueueRef = ref(db, `queue/${uid}`);
  set(myQueueRef, {
    uid,
    username,
    joinedAt: Date.now(),
  });

  // Clean up queue entry if tab closes
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ onDisconnect }) => {
      onDisconnect(myQueueRef).remove();
    });

  // Now try to match
  tryMatch(uid, username);
}

function leaveQueue(uid) {
  const db = window.firebaseDb;
  const ref = window.firebaseRef;
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ remove }) => {
      remove(ref(db, `queue/${uid}`));
    });
}

function tryMatch(myUid, myUsername) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ runTransaction, get, ref, remove, set, onValue }) => {
      const db = window.firebaseDb;
      const queueRef = ref(db, "queue");

      // Run a transaction on the whole queue to safely grab an opponent
      runTransaction(queueRef, (queue) => {
        if (!queue) return queue;

        const entries = Object.values(queue).filter(e => e.uid !== myUid);

        if (entries.length === 0) {
          // No one to match with yet — stay in queue
          return queue;
        }

        // Grab the oldest person in queue
        entries.sort((a, b) => a.joinedAt - b.joinedAt);
        const opponent = entries[0];

        // Remove both from queue inside the transaction
        delete queue[myUid];
        delete queue[opponent.uid];

        return queue;
      }).then((result) => {
        if (!result.committed) {
          console.log("Transaction not committed");
          return;
        }

        const queue = result.snapshot.val() || {};
        const remaining = Object.values(queue);

        // Check if opponent was removed (meaning we matched)
        // If our uid is gone from queue, someone matched us — check currentGame
        // If we did the matching, create the game
        get(ref(db, `queue/${myUid}`)).then(snap => {
          if (!snap.exists()) {
            // We were matched by someone else — listen for our game
            listenForGame(myUid);
          }
        });
      });
    });
}

function createGame(whiteUid, whiteUsername, blackUid, blackUsername) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, set, push }) => {
      const db = window.firebaseDb;
      const gamesRef = ref(db, "games");
      const gameRef = push(gamesRef); // auto-generate game ID
      const gameId = gameRef.key;

      set(gameRef, {
        white: { uid: whiteUid, username: whiteUsername },
        black: { uid: blackUid, username: blackUsername },
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        moves: [],
        status: "playing",
        createdAt: Date.now(),
      });

      // Tell both players which game they're in
      set(ref(db, `users/${whiteUid}/currentGame`), gameId);
      set(ref(db, `users/${blackUid}/currentGame`), gameId);

      console.log("✅ Game created:", gameId);
      return gameId;
    });
}

function listenForGame(uid) {
  import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
    .then(({ ref, onValue }) => {
      const db = window.firebaseDb;
      const gameRef = ref(db, `users/${uid}/currentGame`);

      console.log("👂 Listening for game assignment...");

      const unsub = onValue(gameRef, (snap) => {
        if (snap.exists()) {
          const gameId = snap.val();
          console.log("🎮 Game found:", gameId);
          unsub(); // stop listening
          // TODO: load board with gameId
        }
      });
    });
}

// =======================
// INIT
// =======================
waitForFirebase(() => {
  const auth = window.firebaseAuth;

  window.firebaseOnAuthChanged(auth, user => {
    if (!user) {
      console.log("Not logged in — redirect to login");
      // window.location.href = "login.html"; // uncomment when ready
      return;
    }

    console.log("✅ Logged in as:", user.uid);

    // Fetch username then join queue
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")
      .then(({ ref, get }) => {
        const db = window.firebaseDb;
        get(ref(db, `users/${user.uid}/username`)).then(snap => {
          const username = snap.val() || user.email;
          console.log("👤 Username:", username);

          // Expose for use later
          window.myUid = user.uid;
          window.myUsername = username;

          joinQueue(user.uid, username);
        });
      });
  });
});