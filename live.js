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



console.log("♟ Board ready");

const whiteNameEl = document.getElementById("white-name");
const blackNameEl = document.getElementById("black-name");
const movesEl = document.getElementById("moves");

let lastGameId = "";
let lastMovesLength = 0;

async function getTVGameId() {
  try {
    const res = await fetch("https://lichess.org/api/tv/channels");
    const data = await res.json();

    const gameId =
      data?.bullet?.gameId;

    console.log("📺 current TV game:", gameId);

    return gameId;
  } catch (e) {
    console.log("❌ TV fetch failed:", e);
    return null;
  }
}

async function fetchPGN(gameId) {
  try {
    const res = await fetch(`https://lichess.org/game/export/${gameId}`);
    return await res.text();
  } catch (e) {
    console.log("❌ PGN fetch failed:", e);
    return null;
  }
}

function parsePlayers(pgn) {
  const whiteMatch = pgn.match(/\[White "([^"]+)"\]/);
  const blackMatch = pgn.match(/\[Black "([^"]+)"\]/);

  const whiteElo = pgn.match(/\[WhiteElo "([^"]+)"\]/);
  const blackElo = pgn.match(/\[BlackElo "([^"]+)"\]/);

  const whiteTitle = pgn.match(/\[WhiteTitle "([^"]+)"\]/);
  const blackTitle = pgn.match(/\[BlackTitle "([^"]+)"\]/);

  const whiteName = whiteMatch ? whiteMatch[1] : "White";
  const blackName = blackMatch ? blackMatch[1] : "Black";

  const wTitle = whiteTitle ? `<span class="title">${whiteTitle[1]}</span>` : "";
  const bTitle = blackTitle ? `<span class="title">${blackTitle[1]}</span>` : "";

  const wRating = whiteElo ? `<span class="rating">(${whiteElo[1]})</span>` : "";
  const bRating = blackElo ? `<span class="rating">(${blackElo[1]})</span>` : "";

  const whiteBar = document.getElementById("white-bar");
  const blackBar = document.getElementById("black-bar");

  if (whiteBar) {
    whiteBar.innerHTML = `${wTitle}${whiteName} ${wRating}`;
  }

  if (blackBar) {
    blackBar.innerHTML = `${bTitle}${blackName} ${bRating}`;
  }
}

function clearHighlights() {
  document.querySelectorAll(".highlight-square")
    .forEach(el => el.classList.remove("highlight-square"));
}

function highlightSquare(square) {
  const el = document.querySelector(`.square-${square}`);
  if (el) el.classList.add("highlight-square");
}

function applyMoves(pgn) {
  if (!pgn) return;

  const moveText = pgn.split("\n\n")[1];
  if (!moveText) return;

  const moves = moveText
    .replace(/\{[^}]*\}/g, "")
    .replace(/\d+\./g, "")
    .trim()
    .split(/\s+/);

  for (let i = lastMovesLength; i < moves.length; i++) {
  const san = moves[i];
  const move = game.move(san);

  if (move) {
    console.log("♟ move:", san);

    board.position(game.fen());

    clearHighlights();

    highlightSquare(move.from);
    highlightSquare(move.to);
  }
}

  lastMovesLength = moves.length;

  // update move list UI
  if (movesEl) {
    movesEl.textContent = moves.join(" ");
  }
}

async function update() {
  const gameId = await getTVGameId();
  if (!gameId) return;

  // new game detected
  if (gameId !== lastGameId) {
    console.log("🔥 NEW GAME:", gameId);

    lastGameId = gameId;
    game.reset();
    board.position("start");
    lastMovesLength = 0;
  }

  const pgn = await fetchPGN(gameId);
  if (!pgn) return;

  parsePlayers(pgn);
  applyMoves(pgn);
}

update();
setInterval(update, 3000);