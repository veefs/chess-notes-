(function () {
  "use strict";

  const STORAGE_KEY = "faithchess_settings";
  const DEFAULTS = Object.freeze({
    darkMode: true,
    boardTheme: "classic",
    pieceSet: "cburnett",
    sound: true,
    legalMoves: true,
    animation: true,
    emailNotif: false,
  });
  const BOARD_THEMES = new Set(["classic", "green", "blue", "purple"]);
  const PIECE_THEMES = Object.freeze({
    staunty: Object.freeze({ directory: "pieces/staunty", extension: "svg" }),
    cburnett: Object.freeze({ directory: "pieces/cburnett", extension: "svg" }),
    maestro: Object.freeze({ directory: "pieces/maestro", extension: "svg" }),
    fresca: Object.freeze({ directory: "pieces/fresca", extension: "svg" }),
    california: Object.freeze({ directory: "pieces/california", extension: "svg" }),
    caliente: Object.freeze({ directory: "pieces/caliente", extension: "svg" }),
    cardinal: Object.freeze({ directory: "pieces/cardinal", extension: "svg" }),
    alpha: Object.freeze({ directory: "pieces/alpha", extension: "svg" }),
    fantasy: Object.freeze({ directory: "pieces/fantasy", extension: "svg" }),
    pixel: Object.freeze({ directory: "pieces/pixel", extension: "svg" }),
    tatiana: Object.freeze({ directory: "pieces/tatiana", extension: "svg" }),
    merida: Object.freeze({ directory: "pieces/merida", extension: "svg" }),
    pirouetti: Object.freeze({ directory: "pieces/pirouetti", extension: "svg" }),
    chessnut: Object.freeze({ directory: "pieces/chessnut", extension: "svg" }),
    chess7: Object.freeze({ directory: "pieces/chess7", extension: "svg" }),
    reillycraig: Object.freeze({ directory: "pieces/reillycraig", extension: "svg" }),
    celtic: Object.freeze({ directory: "pieces/celtic", extension: "svg" }),
    spatial: Object.freeze({ directory: "pieces/spatial", extension: "svg" }),
    gioco: Object.freeze({ directory: "pieces/gioco", extension: "svg" }),
    governor: Object.freeze({ directory: "pieces/governor", extension: "svg" }),
    companion: Object.freeze({ directory: "pieces/companion", extension: "svg" }),
    dubrovny: Object.freeze({ directory: "pieces/dubrovny", extension: "svg" }),
    horsey: Object.freeze({ directory: "pieces/horsey", extension: "svg" }),
    icpieces: Object.freeze({ directory: "pieces/icpieces", extension: "svg" }),
    kosal: Object.freeze({ directory: "pieces/kosal", extension: "svg" }),
    leipzig: Object.freeze({ directory: "pieces/leipzig", extension: "svg" }),
    letter: Object.freeze({ directory: "pieces/letter", extension: "svg" }),
    monarchy: Object.freeze({ directory: "pieces/monarchy", extension: "webp" }),
    mpchess: Object.freeze({ directory: "pieces/mpchess", extension: "svg" }),
  });

  function normalizeBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function normalizePieceSet(value) {
    return Object.prototype.hasOwnProperty.call(PIECE_THEMES, value)
      ? value
      : DEFAULTS.pieceSet;
  }

  function normalizeSettings(candidate) {
    const input = candidate && typeof candidate === "object" && !Array.isArray(candidate)
      ? candidate
      : {};

    return {
      darkMode: normalizeBoolean(input.darkMode, DEFAULTS.darkMode),
      boardTheme: BOARD_THEMES.has(input.boardTheme)
        ? input.boardTheme
        : DEFAULTS.boardTheme,
      pieceSet: normalizePieceSet(input.pieceSet),
      sound: normalizeBoolean(input.sound, DEFAULTS.sound),
      legalMoves: normalizeBoolean(input.legalMoves, DEFAULTS.legalMoves),
      animation: normalizeBoolean(input.animation, DEFAULTS.animation),
      emailNotif: normalizeBoolean(input.emailNotif, DEFAULTS.emailNotif),
    };
  }

  function loadSettings() {
    try {
      const saved = window.localStorage?.getItem(STORAGE_KEY);
      return saved ? normalizeSettings(JSON.parse(saved)) : normalizeSettings();
    } catch (error) {
      console.warn("Stored settings could not be read; defaults were restored.", error);
      return normalizeSettings();
    }
  }

  function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    try {
      if (!window.localStorage) throw new Error("Browser storage is unavailable.");
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return normalized;
    } catch (error) {
      console.error("Settings could not be saved.", error);
      throw new Error("Settings could not be saved.", { cause: error });
    }
  }

  function resolvePieceTheme(pieceSet) {
    const normalized = normalizePieceSet(pieceSet);
    const theme = PIECE_THEMES[normalized];
    return `${theme.directory}/{piece}.${theme.extension}`;
  }

  function applySettings(settings) {
    if (!document.body) return;
    document.body.classList.toggle("light-mode", !settings.darkMode);
    document.body.setAttribute("data-board-theme", settings.boardTheme);
  }

  const settings = loadSettings();
  applySettings(settings);

  document.addEventListener("DOMContentLoaded", () => {
    const darkModeToggle = document.getElementById("darkModeToggle");
    const boardTheme = document.getElementById("boardTheme");
    const soundToggle = document.getElementById("soundToggle");
    const legalMovesToggle = document.getElementById("legalMovesToggle");
    const animationToggle = document.getElementById("animationToggle");
    const emailNotifToggle = document.getElementById("emailNotifToggle");
    const saveBtn = document.getElementById("saveBtn");
    const saveMsg = document.getElementById("saveMsg");
    const pieceSet = document.getElementById("pieceSet");

    if (!saveBtn) return;

    darkModeToggle.checked = settings.darkMode;
    boardTheme.value = settings.boardTheme;
    pieceSet.value = settings.pieceSet;
    soundToggle.checked = settings.sound;
    legalMovesToggle.checked = settings.legalMoves;
    animationToggle.checked = settings.animation;
    emailNotifToggle.checked = settings.emailNotif;

    darkModeToggle.addEventListener("change", () => {
      document.body.classList.toggle("light-mode", !darkModeToggle.checked);
    });

    saveBtn.addEventListener("click", () => {
      try {
        const updated = saveSettings({
          darkMode: darkModeToggle.checked,
          boardTheme: boardTheme.value,
          pieceSet: pieceSet.value,
          sound: soundToggle.checked,
          legalMoves: legalMovesToggle.checked,
          animation: animationToggle.checked,
          emailNotif: emailNotifToggle.checked,
        });
        applySettings(updated);
        pieceSet.value = updated.pieceSet;
        saveMsg.textContent = "✓ Settings saved!";
        saveMsg.style.color = "#4caf7d";
      } catch (error) {
        saveMsg.textContent = error.message;
        saveMsg.style.color = "#e05c5c";
      }
      setTimeout(() => {
        saveMsg.textContent = "";
      }, 2500);
    });
  });

  window.getSettings = loadSettings;
  window.resolvePieceTheme = resolvePieceTheme;
})();
