(function () {
  "use strict";

  // Provenance: rows were sampled with HTTP Range bytes=0-65535 from the
  // Lichess puzzle database mirror at immutable revision 006c3249b387e72e5033ea9a20630dc7637934b2.
  // The upstream Lichess database exports are released under CC0:
  // https://database.lichess.org/
  const puzzles = [
    {
      id: "00008",
      fen: "r6k/pp2r2p/4Rp1Q/3p4/8/1N1P2R1/PqP2bPP/7K b - - 0 24",
      solution: ["f2g3", "e6e7", "b2b1", "b3c1", "b1c1", "h6c1"],
      rating: 1935,
    },
    {
      id: "0000D",
      fen: "5rk1/1p3ppp/pq3b2/8/8/1P1Q1N2/P4PPP/3R2K1 w - - 2 27",
      solution: ["d3d6", "f8d8", "d6d8", "f6d8"],
      rating: 1414,
    },
    {
      id: "0008Q",
      fen: "8/4R3/1p2P3/p4r2/P6p/1P3Pk1/4K3/8 w - - 1 64",
      solution: ["e7f7", "f5e5", "e2f1", "e5e6"],
      rating: 1385,
    },
    {
      id: "0009B",
      fen: "r2qr1k1/b1p2ppp/pp4n1/P1P1p3/4P1n1/B2P2Pb/3NBP1P/RN1QR1K1 b - - 1 16",
      solution: ["b6c5", "e2g4", "h3g4", "d1g4"],
      rating: 1084,
    },
    {
      id: "000Pw",
      fen: "6k1/5p1p/4p3/4q3/3nN3/2Q3P1/PP3P1P/6K1 w - - 2 37",
      solution: ["e4d2", "d4e2", "g1f1", "e2c3"],
      rating: 1550,
    },
    {
      id: "000Sa",
      fen: "2Q2bk1/5p1p/p5p1/2p3P1/2r1B3/7P/qPQ2P2/2K4R b - - 0 32",
      solution: ["c4c2", "e4c2", "a2a1", "c2b1"],
      rating: 1582,
    },
    {
      id: "0071N",
      fen: "6k1/p4pp1/1p5p/4b3/4B3/4P1P1/PpR2PKP/3r4 b - - 1 30",
      solution: ["b2b1q", "c2c8", "d1d8", "c8d8"],
      rating: 555,
    },
  ].map((puzzle) => Object.freeze({
    ...puzzle,
    solution: Object.freeze([...puzzle.solution]),
  }));

  window.FAITHCHESS_PUZZLE_DATA = Object.freeze({
    sourceRevision: "006c3249b387e72e5033ea9a20630dc7637934b2",
    sampleRange: "bytes=0-65535",
    license: "CC0",
    licenseUrl: "https://database.lichess.org/",
    puzzles: Object.freeze(puzzles),
  });
})();
