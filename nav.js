// nav.js — shared nav injected on every page

(function () {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  const pages = [
    { href: "index.html",   label: "Home" },
    { href: "play.html",    label: "Play" },
    { href: "puzzles.html", label: "Puzzles" },
    { href: "watch.html",   label: "Watch" },
    { href: "theory.html",  label: "Theory" },
    { href: "profile.html", label: "Profile" },
  ];

  const navItems = pages.map(p => `
    <div class="nav-item ${currentPage === p.href ? "active" : ""}"
         onclick="window.location.href='${p.href}'">
      ${p.label}
    </div>
  `).join("");

  const headerHTML = `
    <div class="logo" onclick="window.location.href='index.html'" style="cursor:pointer;">♟ FaithChess</div>
    <div class="nav">${navItems}</div>
    <div class="nav-spacer"></div>
    <span id="navUsername" class="nav-username hidden"></span>
    <div class="settings-wrap">
      <button class="cog-btn" id="cogBtn" aria-label="Settings">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <div class="cog-dropdown hidden" id="cogDropdown">
        <div class="cog-item" onclick="window.location.href='login.html';">Log In</div>
        <div class="cog-item" onclick="window.location.href='signup.html';">Sign Up</div>
      </div>
    </div>
  `;

  // Inject into <header>
  const header = document.querySelector("header");
  if (header) header.innerHTML = headerHTML;

    const cogBtn = document.getElementById("cogBtn");
  const cogDropdown = document.getElementById("cogDropdown");

  if (cogBtn && cogDropdown) {
    cogBtn.addEventListener("click", e => {
      e.stopPropagation();
      cogDropdown.classList.toggle("hidden");
      cogBtn.classList.toggle("active");
    });

    document.addEventListener("click", () => {
      cogDropdown.classList.add("hidden");
      cogBtn.classList.remove("active");
    });
  }
})();
