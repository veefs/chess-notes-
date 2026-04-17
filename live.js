console.log("🚀 live.js loaded");

// =======================
// BOARD INIT
// =======================
const boardEl = document.getElementById("board");

if (!boardEl) {
  alert("❌ Missing #board element");
  throw new Error("No board element found");
}

const game = new Chess();

const board = Chessboard("board", {
  position: "start",
  draggable: false,
  pieceTheme: "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png"
});

console.log("♟ Board ready");

// =======================
// STATE
// =======================
let lastGameId = "";
let lastMoves = [];

// =======================
// GET TV GAME ID
// =======================
async function getTVGameId() {
  try {
    const res = await fetch("https://lichess.org/api/tv/channels");

    if (!res.ok) {
      console.log("❌ TV channels error:", res.status);
      return null;
    }

    const data = await res.json();

    const gameId = data?.rapid?.gameId; // change to blitz/bullet if wanted

    console.log("📺 current TV game:", gameId);

    return gameId;
  } catch (e) {
    console.log("❌ TV fetch failed:", e);
    return null;
  }
}

// =======================
// FETCH GAME DATA (PGN + PLAYERS)
// =======================
async function fetchGameData(gameId) {
  try {
    const url = `https://lichess.org/game/export/${gameId}`;

    const res = await fetch(url);
    if (!res.ok) return null;

    // ❗ PGN is TEXT, not JSON
    const pgn = await res.text();

    return {
      pgn
    };

  } catch (e) {
    console.log("❌ fetch failed:", e);
    return null;
  }
}

// =======================
// APPLY MOVES INCREMENTALLY
// =======================
function applyMoves(pgn) {
  if (!pgn) return;

  const moves = pgn
    .split("\n")
    .join(" ")
    .replace(/\{[^}]*\}/g, "")
    .split(/\d+\./g)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(m =>
      m &&
      !m.startsWith("[") &&
      !m.includes("Event") &&
      !m.includes("Site") &&
      !m.includes("Round") &&
      !m.includes("White") &&
      !m.includes("Black") &&
      !m.includes("Result")
    );

  for (let i = lastMoves.length; i < moves.length; i++) {
    const move = game.move(moves[i]);

    if (move) {
      console.log("♟ move:", moves[i]);
      board.position(game.fen());
    }
  }

  lastMoves = moves;
}

// =======================
// UPDATE LOOP
// =======================
async function update() {
  const gameId = await getTVGameId();
  if (!gameId) return;

  if (gameId !== lastGameId) {
    console.log("🔥 NEW TV GAME:", gameId);

    lastGameId = gameId;
    game.reset();
    lastMoves = [];
    board.position("start");
  }

  const data = await fetchGameData(gameId);

  if (!data?.pgn) return;

  applyMoves(data.pgn);
}
// =======================
// START
// =======================
update();
setInterval(update, 3000);