const settings = window.getSettings ? window.getSettings() : {};

// =======================
// STATE
// =======================
let puzzle = null;
let step = 0;
let streak = 0;
let inputLocked = false;
let loading = false;
let puzzlePool = [];
let poolLoading = false;
let autoRunning = false;
let playerColor = "white";
let solutionPlaying = false;

// =======================
// GAME + BOARD
// =======================
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

function onMouseoverSquare(square, piece) {
  const settings = window.getSettings ? window.getSettings() : {};
  if (!settings.legalMoves) return;
  if (inputLocked || !puzzle) return;

  const moves = game.moves({ square, verbose: true });
  if (!moves.length) return;
}

function onMouseoutSquare(square, piece) {
  const settings = window.getSettings ? window.getSettings() : {};
  if (!settings.legalMoves) return;

  // Only clear blue highlights, leave green/red from move feedback
  document.querySelectorAll(".highlight-blue").forEach(el => {
    el.classList.remove("highlight-blue");
  });
}

// =======================
// UI
// =======================
const UI = {
  side: () => document.getElementById("sideToMove"),
  rating: () => document.getElementById("puzzleRating"),
  streak: () => document.getElementById("puzzleStreak"),
};

function updateUI() {
  if (!puzzle) return;

  const side = UI.side();
  const rating = UI.rating();
  const streakEl = UI.streak();

  if (side) side.textContent = playerColor === "white" ? "White" : "Black";
  if (rating) rating.textContent = puzzle.rating ?? "-";
  if (streakEl) streakEl.textContent = streak;
}

// =======================
// POPUP
// =======================
const popup = document.getElementById("puzzle-popup");

document.getElementById("retryBtn").onclick = () => {
  popup.classList.add("hidden");
  inputLocked = false;
  solutionPlaying = false;

  if (!puzzle) return;

  step = 0;
  game.load(puzzle.fen);
  board.position(puzzle.fen, false);
  clearHighlights();

  updateUI();
  setTimeout(runAutoSequence, 200);
};

document.getElementById("exitBtn").onclick = () => {
  popup.classList.add("hidden");
  streak = 0;
  solutionPlaying = false;
  start();
};

// View solution button
document.getElementById("viewSolutionBtn").onclick = () => {
  if (solutionPlaying) return;
  playSolution();
};

// =======================
// SOUND SYSTEM
// =======================
const sounds = {
  move: new Audio("sounds/move-self.mp3"),
  capture: new Audio("sounds/capture.mp3"),
  check: new Audio("sounds/move-check.mp3"),
  correct: new Audio("sounds/shoutout.mp3"),
  incorrect: new Audio("sounds/puzzle-wrong.mp3"),
};

function playSound(name) {
  console.log(settings.sound);
  if(!settings.sound) return;
  
  const s = sounds[name];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => { });
}

// =======================
// CSV PARSER
// =======================
function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }

  out.push(cur);
  return out;
}

// =======================
// PUZZLE LOADER
// =======================
async function fetchPuzzle() {
  if (puzzlePool.length) return puzzlePool.pop();
  if (poolLoading) return null;

  poolLoading = true;

  const res = await fetch("https://media.githubusercontent.com/media/veefs/chess-notes-/refs/heads/main/lichess_db_puzzles.csv"); const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let header = false;
  let collected = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let lines = buffer.split("\n");
    buffer = lines.pop();

    for (const line of lines) {
      if (!header) {
        header = true;
        continue;
      }

      const p = splitCSVLine(line);
      if (p.length < 4) continue;

      if (Math.random() < 0.01) {
        collected.push({
          id: p[0],
          fen: p[1],
          solution: p[2].split(" "),
          rating: parseInt(p[3]),
        });

        if (collected.length >= 100) break;
      }
    }

    if (collected.length >= 100) break;
  }

  puzzlePool = collected;
  poolLoading = false;

  return puzzlePool.pop();
}

// =======================
// HIGHLIGHT HELPERS
// =======================
function clearHighlights() {
  document.querySelectorAll(".highlight-green, .highlight-red, .highlight-blue").forEach(el => {
    el.classList.remove("highlight-green", "highlight-red", "highlight-blue");
  });
}

function highlightSquare(square, type) {
  const el = document.querySelector(`.square-${square}`);
  if (!el) return;
  if (type === "green") el.classList.add("highlight-green");
  else if (type === "red") el.classList.add("highlight-red");
  else if (type === "blue") el.classList.add("highlight-blue");
}

// =======================
// UCI → ALGEBRAIC
// =======================
function uciToAlgebraic(fen, uci) {
  const temp = new Chess(fen);
  const move = temp.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] || "q",
  });
  return move ? move.san : uci;
}

function buildSolutionNotation(startFen, moves) {
  const temp = new Chess(startFen);
  const notations = [];

  for (const uci of moves) {
    const move = temp.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || "q",
    });
    if (move) notations.push(move.san);
  }

  return notations;
}

// =======================
// VIEW SOLUTION
// =======================
function playSolution() {
  if (!puzzle) return;
  solutionPlaying = true;
  inputLocked = true;
  popup.classList.add("hidden"); // ← hide popup while solution plays

  // Reset to puzzle start position first
  game.load(puzzle.fen);
  board.position(puzzle.fen, false);
  clearHighlights();

  const notations = buildSolutionNotation(puzzle.fen, puzzle.solution);

  // Show notation in panel
  const solutionEl = document.getElementById("solutionMoves");
  if (solutionEl) {
    solutionEl.textContent = notations.join(", ");
    solutionEl.closest(".panel-row").classList.remove("hidden");
  }

  // Play moves one by one
  let i = 0;
  const tempGame = new Chess(puzzle.fen);

  function playNext() {
    if (i >= puzzle.solution.length) {
      solutionPlaying = false;
      popup.classList.remove("hidden");
      popup.querySelector("#puzzle-title").textContent = "Solution complete!";
      popup.querySelector("#puzzle-desc").textContent = `You can try the puzzle again or move on to the next one.`;
      return;
    }

    const uci = puzzle.solution[i];
    const move = tempGame.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4] || "q",
    });

    if (!move) {
      solutionPlaying = false;
      return;
    }

    board.position(tempGame.fen(), true);
    clearHighlights();

    // Blue for opponent moves, green for player moves
    const isOpponentMove = (i % 2 === 0);
    const color = isOpponentMove ? "blue" : "green";
    highlightSquare(uci.slice(0, 2), color);
    highlightSquare(uci.slice(2, 4), color);

    playSound(move.captured ? "capture" : "move");

    i++;
    setTimeout(playNext, 800);
  }

  playNext();
}

// =======================
// DRAG START — don't clear highlights on drag start
// =======================
function onDragStart(source, piece) {
  if (inputLocked || !puzzle) return false;

  const settings = window.getSettings ? window.getSettings() : {};
  if (settings.legalMoves) {
    clearLegalDots();
    const moves = game.moves({ square: source, verbose: true });
    moves.forEach(m => {
      const el = document.querySelector(`.square-${m.to}`);
      if (!el) return;
      // If there's a piece on that square it's a capture — show ring instead
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

// =======================
// AUTO SEQUENCE ENGINE
// =======================
function runAutoSequence() {
  if (!puzzle || autoRunning || step >= puzzle.solution.length) return;

  autoRunning = true;

  console.log("▶️ Auto sequence start | step:", step);

  const uci = puzzle.solution[step];

  const move = game.move({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] || "q",
  });

  if (move) {
    board.position(game.fen(), true);
    clearHighlights();
    highlightSquare(uci.slice(0, 2), "blue");
    highlightSquare(uci.slice(2, 4), "blue");
    step++;
  }

  autoRunning = false;
}

// =======================
// MOVE HANDLER
// =======================
function onDrop(source, target) {
  clearLegalDots();
  if (inputLocked || !puzzle) return "snapback";

  const expected = puzzle.solution[step];
  const expectedFrom = expected.slice(0, 2);
  const expectedTo = expected.slice(2, 4);

  const move = game.move({
    from: source,
    to: target,
    promotion: "q",
  });

  // Invalid move
  if (!move) return "snapback";

  let soundType = "move";
  if (move.captured) soundType = "capture";
  if (game.in_check()) soundType = "check";
  playSound(soundType);

  // ❌ WRONG MOVE
  if (source !== expectedFrom || target !== expectedTo) {
    clearHighlights();
    highlightSquare(target, "red");
    playSound("incorrect");
    inputLocked = true;
    streak = 0;
    popup.classList.remove("hidden");
    updateUI();
    return;
  }

  // ✅ CORRECT MOVE
  clearHighlights();
  highlightSquare(source, "green");
  highlightSquare(target, "green");

  step++;

  if (step >= puzzle.solution.length) {
    // Puzzle complete
    playSound("correct");
    setTimeout(() => {
      streak++;
      updateUI();
      start();
    }, 1000);
  } else {
    // Play opponent's response
    setTimeout(runAutoSequence, 300);
  }
}

// =======================
// LOAD PUZZLE
// =======================
function loadPuzzle(p) {
  puzzle = p;
  step = 0;
  inputLocked = false;
  solutionPlaying = false;

  // Figure out player color: after the first move (step 0, opponent's move),
  // it's the player's turn. The FEN tells us whose turn it is currently.
  // The opponent plays first, so player color is opposite of current turn.
  const tempGame = new Chess(p.fen);
  playerColor = tempGame.turn() === "w" ? "black" : "white";

  game.load(p.fen);
  board.orientation(playerColor);
  board.position(p.fen, false);
  clearHighlights();

  // Hide solution row
  const solutionEl = document.getElementById("solutionMoves");
  if (solutionEl) {
    solutionEl.textContent = "";
    solutionEl.closest(".panel-row").classList.add("hidden");
  }

  updateUI();

  console.log("✅ Puzzle loaded:", p.id, "| Player:", playerColor);

  setTimeout(runAutoSequence, 200);
}

// =======================
// START
// =======================
async function start() {
  if (loading) return;

  loading = true;
  inputLocked = false;

  const p = await fetchPuzzle();

  if (!p) {
    console.log("No puzzle loaded");
    loading = false;
    return;
  }

  loadPuzzle(p);

  loading = false;
}

start();