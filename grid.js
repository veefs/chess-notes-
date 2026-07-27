const boardIds = ["board1", "board2", "board3", "board4"];

const instances = boardIds.map((id) => {
  const board = Chessboard(id, {
    position: "start",
    draggable: false,
    pieceTheme:
      "https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png",
  });

  return {
    id,
    board,
    game: new Chess(),
    lastMovesLength: 0,
    gameId: null,
  };
});

console.log("♟ 4 independent boards ready");

async function getTVGames() {
  const res = await fetch("https://lichess.org/api/tv/channels");
  const data = await res.json();

  return [
    data?.bullet?.gameId,
    data?.blitz?.gameId,
    data?.rapid?.gameId,
    data?.classical?.gameId,
  ].filter(Boolean);
}

async function fetchPGN(gameId) {
  const res = await fetch(`https://lichess.org/game/export/${gameId}`);
  return await res.text();
}

function parsePlayers(pgn, prefix) {
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

  const whiteBar = document.getElementById(`${prefix}-white`);
  const blackBar = document.getElementById(`${prefix}-black`);

  if (whiteBar) {
    whiteBar.innerHTML = `${wTitle}${whiteName} ${wRating}`;
  }

  if (blackBar) {
    blackBar.innerHTML = `${bTitle}${blackName} ${bRating}`;
  }
}
function clearHighlights(boardId) {
  document
    .querySelectorAll(`#${boardId} .highlight-square`)
    .forEach(el => el.classList.remove("highlight-square"));
}

function highlightSquare(boardId, square) {
  const el = document.querySelector(`#${boardId} .square-${square}`);
  if (el) el.classList.add("highlight-square");
}

function applyMoves(instance, pgn) {
  const moveText = pgn.split("\n\n")[1];
  if (!moveText) return;

  const moves = moveText
    .replace(/\{[^}]*\}/g, "")
    .replace(/\d+\./g, "")
    .trim()
    .split(/\s+/);

  for (let i = instance.lastMovesLength; i < moves.length; i++) {
    const san = moves[i];
    const move = instance.game.move(san);

    if (move) {
      instance.board.position(instance.game.fen());

      clearHighlights(instance.id);
      highlightSquare(instance.id, move.from);
      highlightSquare(instance.id, move.to);
    }
  }

  instance.lastMovesLength = moves.length;
}

async function update() {
  const gameIds = await getTVGames();

  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    const gameId = gameIds[i];

    if (!gameId) continue;

    if (inst.gameId !== gameId) {
      inst.gameId = gameId;
      inst.game.reset();
      inst.board.position("start");
      inst.lastMovesLength = 0;
    }

    const pgn = await fetchPGN(gameId);
    if (!pgn) continue;

    parsePlayers(pgn, inst.id);
    applyMoves(inst, pgn);
  }
}

update();
setInterval(update, 3000);