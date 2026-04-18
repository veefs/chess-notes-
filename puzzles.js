console.log("🧩 Lichess ELO puzzle system loaded");

// =======================
// STATE
// =======================
let puzzle = null;
let step = 0;
let streak = 0;

// =======================
// GAME + BOARD
// =======================
const game = new Chess();

const board = Chessboard("board", {
  draggable: true,
  moveSpeed: 0,
  snapSpeed: 0,
  snapbackSpeed: 0,
  position: "start",
  pieceTheme:
    "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
  onDrop: onDrop,
});

// =======================
// UI
// =======================
const popup = document.getElementById("puzzle-popup");
const sideEl = document.getElementById("sideToMove");
const ratingEl = document.getElementById("puzzleRating");
const streakEl = document.getElementById("puzzleStreak");

// =======================
// SOUND
// =======================
const sounds = {
  move: new Audio("sounds/move-self.mp3"),
  capture: new Audio("sounds/capture.mp3"),
  check: new Audio("sounds/move-check.mp3"),
};

function playSound(t) {
  const s = sounds[t];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => {});
}

// =======================
// BUTTONS
// =======================

// RETRY → reload SAME puzzle (fix)
document.getElementById("retryBtn").onclick = () => {
  popup.classList.add("hidden");

  if (!puzzle) return;

  step = 0;
  game.load(puzzle.fen);
  board.position(puzzle.fen, false);

  console.log("🔁 puzzle reset");
};

// EXIT → new puzzle + reset streak
document.getElementById("exitBtn").onclick = () => {
  popup.classList.add("hidden");

  streak = 0;
  start();
};

// =======================
// SOLUTION BUTTON (NEW)
// =======================
document.getElementById("solutionBtn").onclick = () => {
  if (!puzzle) return;

  streak = 0; // ends streak immediately
  updateUI();

  const sanMoves = convertSolutionToSAN(puzzle.fen, puzzle.solution);

  console.log("📖 Solution (SAN):");
  console.log(sanMoves.join(" → "));

  alert("Solution:\n\n" + sanMoves.join(" → "));
};

// =======================
// FETCH PUZZLE
// =======================
async function fetchPuzzle() {
  const res = await fetch("https://lichess.org/api/puzzle/next");
  const data = await res.json();

  const p = data.puzzle;
  const g = data.game;

  if (!p || !g?.pgn) return null;

  const fen = buildFenFromGame(g.pgn, p.initialPly);

  return {
    fen,
    solution: p.solution, // UCI
    rating: p.rating,
    turn: fen.split(" ")[1] === "w" ? "White" : "Black",
  };
}

// =======================
// SAN CONVERSION (IMPORTANT FIX)
// =======================
function convertSolutionToSAN(fen, solution) {
  const g = new Chess(fen);
  const san = [];

  for (const uci of solution) {
    const move = g.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || "q",
    });

    if (!move) break;
    san.push(move.san);
  }

  return san;
}

// =======================
// BUILD FEN
// =======================
function buildFenFromGame(pgn, ply) {
  const g = new Chess();

  const moves = pgn
    .replace(/\{[^}]*\}/g, "")
    .replace(/\d+\.\.\./g, "")
    .replace(/\d+\./g, "")
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (let i = 0; i < ply && i < moves.length; i++) {
    g.move(moves[i], { sloppy: true });
  }

  return g.fen();
}

// =======================
// LOAD PUZZLE
// =======================
function loadPuzzle(p) {
  puzzle = p;
  step = 0;

  game.load(p.fen);
  board.position(p.fen, false);

  updateUI();

  console.log("✅ Puzzle loaded");
}

// =======================
// UI UPDATE
// =======================
function updateUI() {
  if (!puzzle) return;

  sideEl.textContent = puzzle.turn;
  ratingEl.textContent = puzzle.rating;
  streakEl.textContent = streak;
}

// =======================
// HIGHLIGHT
// =======================
function highlight(square, cls) {
  const el = document.querySelector(`.square-${square}`);
  if (!el) return;

  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 700);
}

// =======================
// MOVE HANDLER
// =======================
function onDrop(source, target) {
  const move = game.move({
    from: source,
    to: target,
    promotion: "q",
  });

  if (!move) return "snapback";

  board.position(game.fen(), false);

  const played = source + target + (move.promotion || "");
  const expected = puzzle.solution[step];

  // WRONG
  if (played !== expected) {
    highlight(target, "wrong-square");
    popup.classList.remove("hidden");
    streak = 0;
    updateUI();
    return;
  }

  // CORRECT
  highlight(target, "correct-square");
  playSound(move.flags.includes("c") ? "capture" : "move");

  if (game.in_check()) playSound("check");

  step++;

  // AUTO OPPONENT
  setTimeout(() => {
    if (step >= puzzle.solution.length) {
      streak++;
      updateUI();
      start();
      return;
    }

    const uci = puzzle.solution[step];

    const reply = game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || "q",
    });

    if (reply) {
      board.position(game.fen(), false);

      playSound(reply.flags.includes("c") ? "capture" : "move");

      if (game.in_check()) playSound("check");

      step++;
    }
  }, 300);
}

// =======================
// START
// =======================
async function start() {
  const p = await fetchPuzzle();

  if (!p) {
    console.log("❌ No puzzle loaded");
    return;
  }

  loadPuzzle(p);
}

start();