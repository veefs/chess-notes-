(function () {
  const DEFAULTS = {
    darkMode: true,
    boardTheme: "classic",
    pieceSet: "cburnett",
    sound: true,
    legalMoves: true,
    animation: true,
    emailNotif: false,
  };

  function loadSettings() {
    const saved = localStorage.getItem("faithchess_settings");
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : { ...DEFAULTS };
  }

  function saveSettings(settings) {
    localStorage.setItem("faithchess_settings", JSON.stringify(settings));
  }

  function applySettings(settings) {
    document.body.classList.toggle("light-mode", !settings.darkMode);
    document.body.setAttribute("data-board-theme", settings.boardTheme);
  }

  // Apply on every page load
  const settings = loadSettings();
  applySettings(settings);

  // Only wire up the form if we're on settings.html
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
    if (pieceSet) pieceSet.value = settings.pieceSet || "cburnett";

    if (!saveBtn) return; // not on settings page

    // Populate form with current settings
    darkModeToggle.checked = settings.darkMode;
    boardTheme.value = settings.boardTheme;
    soundToggle.checked = settings.sound;
    legalMovesToggle.checked = settings.legalMoves;
    animationToggle.checked = settings.animation;
    emailNotifToggle.checked = settings.emailNotif;

    // Live preview dark mode toggle
    darkModeToggle.addEventListener("change", () => {
      document.body.classList.toggle("light-mode", !darkModeToggle.checked);
    });

    saveBtn.addEventListener("click", () => {
      const updated = {
  darkMode:   darkModeToggle.checked,
  boardTheme: boardTheme.value,
  pieceSet:   pieceSet ? pieceSet.value : "staunty",   // ← add
  sound:      soundToggle.checked,
  legalMoves: legalMovesToggle.checked,
  animation:  animationToggle.checked,
  emailNotif: emailNotifToggle.checked,
};
      saveSettings(updated);
      applySettings(updated);
      saveMsg.textContent = "✓ Settings saved!";
      setTimeout(() => saveMsg.textContent = "", 2500);
    });
  });

  // Expose for use in other scripts (e.g. play.js checking sound/animation)
  window.getSettings = loadSettings;
})();