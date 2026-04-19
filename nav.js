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

    <div class="settings-wrap" style="margin-right:8px;">
      <button class="cog-btn" id="inboxBtn" aria-label="Inbox">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
  <polyline points="22,6 12,13 2,6"/>
</svg>
        <span id="inboxBadge" class="inbox-badge hidden">0</span>
      </button>
      <div class="cog-dropdown hidden" id="inboxDropdown">
        <div class="cog-item" style="color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;">Challenges</div>
        <div class="cog-divider"></div>
        <div id="inboxList"><div class="cog-item" style="color:var(--muted);font-size:13px;">No pending challenges</div></div>
      </div>
    </div>

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

  const header = document.querySelector("header");
  if (header) header.innerHTML = headerHTML;

  // Cog toggle
  const cogBtn = document.getElementById("cogBtn");
  const cogDropdown = document.getElementById("cogDropdown");
  const inboxBtn = document.getElementById("inboxBtn");
  const inboxDropdown = document.getElementById("inboxDropdown");

  if (cogBtn && cogDropdown) {
    cogBtn.addEventListener("click", e => {
      e.stopPropagation();
      inboxDropdown.classList.add("hidden");
      cogDropdown.classList.toggle("hidden");
      cogBtn.classList.toggle("active");
      inboxBtn.classList.remove("active");
    });
  }

  if (inboxBtn && inboxDropdown) {
    inboxBtn.addEventListener("click", e => {
      e.stopPropagation();
      cogDropdown.classList.add("hidden");
      cogBtn.classList.remove("active");
      inboxDropdown.classList.toggle("hidden");
      inboxBtn.classList.toggle("active");
    });
  }

  document.addEventListener("click", () => {
    cogDropdown.classList.add("hidden");
    cogBtn.classList.remove("active");
    inboxDropdown.classList.add("hidden");
    inboxBtn.classList.remove("active");
  });
})();