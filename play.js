// =======================
// RATING SYSTEM (simple Elo)
// =======================
function calcElo(myRating, opponentRating, result) {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (opponentRating - myRating) / 400));
  const score = result === "win" ? 1 : result === "draw" ? 0.5 : 0;
  return Math.round(K * (score - expected));
}

// =======================
// SAVE GAME TO HISTORY
// =======================
async function saveGameResult(result) {
  // result: "win" | "loss" | "draw"
  if (!window.myUid || !currentGameId) return;

  const { ref, get, set, push } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const db = window.firebaseDb;

  // Get game data
  const gameSnap = await get(ref(db, `games/${currentGameId}`));
  const gameData = gameSnap.val();
  if (!gameData) return;

  const opponentUid = myColor === "white" ? gameData.black?.uid : gameData.white?.uid;
  const opponentUsername = myColor === "white" ? gameData.black?.username : gameData.white?.username;

  // Get both ratings
  const mySnap = await get(ref(db, `users/${window.myUid}/rating`));
  const oppSnap = await get(ref(db, `users/${opponentUid}/rating`));

  const myRating = mySnap.val() ?? 1200;
  const oppRating = oppSnap.val() ?? 1200;
  const ratingChange = calcElo(myRating, oppRating, result);

  const moves = game.history();

  // Write game to my history
  await push(ref(db, `users/${window.myUid}/gameHistory`), {
    gameId: currentGameId,
    myColor,
    opponentUid,
    opponentUsername,
    result,
    ratingChange,
    moveCount: moves.length,
    playedAt: Date.now(),
  });

  // Update my stats + rating
  const statsSnap = await get(ref(db, `users/${window.myUid}`));
  const stats = statsSnap.val() || {};

  await set(ref(db, `users/${window.myUid}/rating`), myRating + ratingChange);
  await set(ref(db, `users/${window.myUid}/wins`), (stats.wins ?? 0) + (result === "win" ? 1 : 0));
  await set(ref(db, `users/${window.myUid}/losses`), (stats.losses ?? 0) + (result === "loss" ? 1 : 0));
  await set(ref(db, `users/${window.myUid}/draws`), (stats.draws ?? 0) + (result === "draw" ? 1 : 0));

  console.log(`📊 Game saved | Result: ${result} | Rating: ${myRating} → ${myRating + ratingChange}`);
}

// =======================
// DETECT GAME OVER + SAVE
// =======================
function checkGameOver() {
  if (!game.game_over()) return;

  let result;

  if (game.in_checkmate()) {
    // The player whose turn it is got checkmated — they lost
    const loserTurn = game.turn(); // "w" or "b"
    const iLost = (myColor === "white" && loserTurn === "w") ||
                  (myColor === "black" && loserTurn === "b");
    result = iLost ? "loss" : "win";
  } else {
    result = "draw";
  }

  console.log("🏁", getGameOverMessage());
  saveGameResult(result);
}