console.log("🧩 Lichess ELO puzzle system loaded");

// =======================
// STATE
// =======================
let puzzle = null;
let step = 0;
let streak = 0;
let inputLocked = false;

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
// SAFE UI (NO CRASHES)
// =======================
const UI = {
  side: () => document.getElementById("sideToMove"),
  rating: () => document.getElementById("puzzleRating"),
  streak: () => document.getElementById("puzzleStreak"),
};

// =======================
// UPDATE UI
// =======================
function updateUI() {
  if (!puzzle) return;

  const side = UI.side();
  const rating = UI.rating();
  const streakEl = UI.streak();

  if (side) side.textContent = game.turn() === "w" ? "White" : "Black";
  if (rating) rating.textContent = puzzle.rating ?? "-";
  if (streakEl) streakEl.textContent = streak;
}

// =======================
// POPUP
// =======================
const popup = document.getElementById("puzzle-popup");

// Retry = restart SAME puzzle (fixed)
document.getElementById("retryBtn").onclick = () => {
  popup.classList.add("hidden");
  inputLocked = false;

  if (!puzzle) return;

  step = 0;
  game.load(puzzle.fen);
  board.position(puzzle.fen, false);

  updateUI();
};

// Exit = new puzzle + reset streak
document.getElementById("exitBtn").onclick = () => {
  popup.classList.add("hidden");
  streak = 0;
  start();
};

// =======================
// SOLUTION BUTTON (FIXED)
// =======================
document.getElementById("solutionBtn").onclick = () => {
  if (!puzzle) return;

  inputLocked = true;
  streak = 0;
  updateUI();

  const san = convertToSAN(puzzle.fen, puzzle.solution);

  console.log("📖 SOLUTION:");
  console.log(san.join(" → "));

  alert("Solution:\n\n" + san.join(" → "));
};

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
// FETCH PUZZLE
// =======================
async function fetchPuzzle() {
  try {
    const res = await fetch("https://lichess.org/api/puzzle/next");
    const data = await res.json();

    const p = data.puzzle;
    const g = data.game;

    if (!p || !g?.pgn) return null;

    const fen = buildFen(g.pgn, p.initialPly);

    return {
      fen,
      solution: p.solution,
      rating: p.rating,
    };
  } catch (e) {
    console.log("❌ fetch error", e);
    return null;
  }
}

// =======================
// BUILD FEN
// =======================
function buildFen(pgn, ply) {
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
// UCI → SAN (FIXED)
// =======================
function convertToSAN(fen, solution) {
  const g = new Chess(fen);
  const out = [];

  for (const uci of solution) {
    const move = g.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || "q",
    });

    if (!move) break;
    out.push(move.san);
  }

  return out;
}

// =======================
// LOAD PUZZLE
// =======================
function loadPuzzle(p) {
  puzzle = p;
  step = 0;
  inputLocked = false;

  game.load(p.fen);
  board.position(p.fen, false);

  updateUI();

  console.log("✅ Puzzle loaded");
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
  if (inputLocked || !puzzle) return "snapback";

  const move = game.move({
    from: source,
    to: target,
    promotion: "q",
  });

  if (!move) return "snapback";

  board.position(game.fen(), false);

  const played = source + target + (move.promotion || "");
  const expected = puzzle.solution[step];

  // WRONG MOVE
  if (played !== expected) {
    inputLocked = true;

    highlight(target, "wrong-square");

    popup.classList.remove("hidden");

    streak = 0;
    updateUI();

    return;
  }

  // CORRECT MOVE
  highlight(target, "correct-square");

  playSound(move.flags.includes("c") ? "capture" : "move");
  if (game.in_check()) playSound("check");

  step++;

  // OPPONENT MOVE
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
  inputLocked = false;

  const p = await fetchPuzzle();

  if (!p) {
    console.log("❌ No puzzle loaded");
    return;
  }

  loadPuzzle(p);
}

start();