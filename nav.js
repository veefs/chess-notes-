(function () {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";

  const pages = [
    { href: "index.html", label: "Home" },
    { href: "play.html", label: "Play" },
    { href: "arena.html", label: "Arena" },
    { href: "puzzles.html", label: "Puzzles" },
    { href: "watch.html", label: "Watch" },
    { href: "theory.html", label: "Theory" },
    { href: "profile.html", label: "Profile" },
  ];

  const navItems = pages.map(page => `
    <a class="nav-item ${currentPage === page.href ? "active" : ""}"
       href="${page.href}"${currentPage === page.href ? ' aria-current="page"' : ""}>
      ${page.label}
    </a>
  `).join("");

  const headerHTML = `
    <a class="logo" href="index.html" aria-label="FaithChess home">♟ FaithChess</a>
    <nav class="nav" aria-label="Primary">${navItems}</nav>
    <div class="nav-spacer"></div>
    <span id="navUsername" class="nav-username hidden"></span>

    <div class="settings-wrap inbox-wrap">
      <button class="cog-btn" id="inboxBtn" type="button" aria-label="Inbox"
              aria-expanded="false" aria-controls="inboxDropdown" aria-haspopup="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
        <span id="inboxBadge" class="inbox-badge hidden">0</span>
      </button>
      <div class="cog-dropdown hidden" id="inboxDropdown" aria-labelledby="inboxBtn">
        <div class="cog-item cog-heading">Challenges</div>
        <div class="cog-divider"></div>
        <div id="inboxList" aria-live="polite"><div class="cog-item cog-empty">No pending challenges</div></div>
      </div>
    </div>

    <div class="settings-wrap account-wrap">
      <button class="cog-btn" id="cogBtn" type="button" aria-label="Account"
              aria-expanded="false" aria-controls="cogDropdown" aria-haspopup="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <div class="cog-dropdown hidden" id="cogDropdown" aria-labelledby="cogBtn">
        <a class="cog-item" href="login.html">Log In</a>
        <a class="cog-item" href="signup.html">Sign Up</a>
      </div>
    </div>
  `;

  const header = document.querySelector("header");
  if (!header) return;
  header.innerHTML = headerHTML;

  const cogBtn = document.getElementById("cogBtn");
  const cogDropdown = document.getElementById("cogDropdown");
  const inboxBtn = document.getElementById("inboxBtn");
  const inboxDropdown = document.getElementById("inboxDropdown");

  function setDropdown(button, dropdown, open) {
    if (!button || !dropdown) return;
    dropdown.classList.toggle("hidden", !open);
    button.classList.toggle("active", open);
    button.setAttribute("aria-expanded", String(open));
  }

  function closeDropdowns(exceptButton = null) {
    if (exceptButton !== cogBtn) setDropdown(cogBtn, cogDropdown, false);
    if (exceptButton !== inboxBtn) setDropdown(inboxBtn, inboxDropdown, false);
  }

  function toggleDropdown(button, dropdown) {
    const willOpen = dropdown.classList.contains("hidden");
    closeDropdowns(button);
    setDropdown(button, dropdown, willOpen);
  }

  function makeInjectedActionsKeyboardAccessible(root) {
    if (!root) return;
    root.querySelectorAll(".cog-item").forEach(item => {
      if (item.matches("a, button") || item.classList.contains("cog-user")
          || item.classList.contains("cog-heading") || item.classList.contains("cog-empty")) return;
      item.setAttribute("role", "button");
      item.tabIndex = 0;
    });
  }

  cogBtn?.addEventListener("click", event => {
    event.stopPropagation();
    toggleDropdown(cogBtn, cogDropdown);
  });

  inboxBtn?.addEventListener("click", event => {
    event.stopPropagation();
    toggleDropdown(inboxBtn, inboxDropdown);
  });

  header.addEventListener("keydown", event => {
    const action = event.target.closest(".cog-item[role='button']");
    if (action && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      action.click();
      return;
    }

    if (event.key !== "Escape") return;
    const openButton = cogBtn?.getAttribute("aria-expanded") === "true"
      ? cogBtn
      : inboxBtn?.getAttribute("aria-expanded") === "true"
        ? inboxBtn
        : null;
    if (!openButton) return;
    closeDropdowns();
    openButton.focus();
  });

  header.addEventListener("click", event => {
    if (!event.target.closest(".settings-wrap")) closeDropdowns();
  });

  document.addEventListener("click", () => closeDropdowns());

  const observer = new MutationObserver(() => {
    makeInjectedActionsKeyboardAccessible(cogDropdown);
    makeInjectedActionsKeyboardAccessible(inboxDropdown);
  });
  observer.observe(cogDropdown, { childList: true, subtree: true });
  observer.observe(inboxDropdown, { childList: true, subtree: true });
  makeInjectedActionsKeyboardAccessible(cogDropdown);
  makeInjectedActionsKeyboardAccessible(inboxDropdown);
})();
