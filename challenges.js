// challenges.js — FaithChess challenge system
// Include on every page: <script type="module" src="challenges.js"></script>

import { getDatabase, ref, set, get, push, remove, onValue, onDisconnect }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { initializeApp, getApps }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";

const firebaseConfig = {
  apiKey: "AIzaSyAUdXVlmN9xhhIzubK0MTtGO3hA9JkHClA",
  authDomain: "faithchess.firebaseapp.com",
  databaseURL: "https://faithchess-default-rtdb.firebaseio.com",
  projectId: "faithchess",
  storageBucket: "faithchess.firebasestorage.app",
  messagingSenderId: "132292001988",
  appId: "1:132292001988:web:3c9b7227f1b09766b48991"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getDatabase(app);
const auth = getAuth(app);

// ─── Inject styles ───────────────────────────────────────────────────────────
const style = document.createElement("style");
style.textContent = `
/* ── Challenge Toast ── */
#challenge-toast {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
}

.challenge-toast-card {
  pointer-events: all;
  background: linear-gradient(145deg, #1e1c1a, #252220);
  border: 1px solid #3a3632;
  border-left: 3px solid var(--accent, #a594c0);
  border-radius: 10px;
  padding: 14px 16px;
  min-width: 280px;
  max-width: 320px;
  box-shadow: 0 8px 32px rgba(0,0,0,.6);
  animation: toast-in .3s cubic-bezier(.34,1.56,.64,1) forwards;
  font-family: 'Outfit', sans-serif;
}

.challenge-toast-card.toast-out {
  animation: toast-out .3s ease forwards;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateX(40px) scale(.95); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes toast-out {
  from { opacity: 1; transform: translateX(0) scale(1); }
  to   { opacity: 0; transform: translateX(40px) scale(.9); }
}

.toast-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.toast-icon {
  font-size: 18px;
  line-height: 1;
}

.toast-title {
  font-size: 13px;
  font-weight: 700;
  color: #edeae4;
  flex: 1;
}

.toast-sub {
  font-size: 12px;
  color: #635f58;
  margin-bottom: 12px;
}

.toast-actions {
  display: flex;
  gap: 8px;
}

.toast-btn {
  flex: 1;
  padding: 7px 0;
  border: none;
  border-radius: 6px;
  font-family: 'Outfit', sans-serif;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity .2s, transform .1s;
}

.toast-btn:active { transform: scale(.97); }
.toast-btn:hover  { opacity: .85; }

.toast-btn-accept {
  background: var(--accent, #a594c0);
  color: #fff;
}

.toast-btn-decline {
  background: #2a2826;
  color: #635f58;
  border: 1px solid #3a3632;
}

.toast-progress {
  height: 2px;
  background: #2a2826;
  border-radius: 1px;
  margin-top: 12px;
  overflow: hidden;
}

.toast-progress-bar {
  height: 100%;
  background: var(--accent, #a594c0);
  width: 100%;
  transition: width linear;
}

/* ── Mailbox Button ── */
#mailbox-btn {
  position: relative;
  background: none;
  border: none;
  color: var(--muted, #635f58);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: color .2s;
}

#mailbox-btn:hover { color: var(--text2, #edeae4); }

#mailbox-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  background: var(--accent, #a594c0);
  color: #fff;
  border-radius: 99px;
  font-size: 9px;
  font-weight: 700;
  min-width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
  line-height: 1;
  pointer-events: none;
}

#mailbox-badge.hidden { display: none; }

/* ── Mailbox Dropdown ── */
#mailbox-dropdown {
  position: absolute;
  right: 0;
  top: calc(100% + 10px);
  background: var(--bg2, #181716);
  border: 1px solid var(--border, #2e2c2a);
  border-radius: var(--radius, 8px);
  min-width: 260px;
  max-width: 300px;
  box-shadow: 0 8px 32px rgba(0,0,0,.6);
  z-index: 9998;
  overflow: hidden;
  font-family: 'Outfit', sans-serif;
}

.mailbox-header {
  padding: 10px 14px 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--muted, #635f58);
  border-bottom: 1px solid var(--border, #2e2c2a);
}

.mailbox-empty {
  padding: 18px 14px;
  font-size: 13px;
  color: var(--muted, #635f58);
  text-align: center;
}

.mailbox-item {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255,255,255,.04);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mailbox-item-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text2, #edeae4);
}

.mailbox-item-sub {
  font-size: 11px;
  color: var(--muted, #635f58);
}

.mailbox-item-actions {
  display: flex;
  gap: 8px;
}

.mailbox-item-actions .toast-btn {
  padding: 5px 0;
  font-size: 11px;
}

/* ── Mailbox wrap (sits beside settings-wrap in nav) ── */
.mailbox-wrap {
  position: relative;
}
`;
document.head.appendChild(style);

// ─── State ───────────────────────────────────────────────────────────────────
let myUid      = null;
let myUsername = null;
const DISMISS_DELAY = 5000; // ms before toast auto-dismisses

// ─── Toast container ─────────────────────────────────────────────────────────
const toastContainer = document.createElement("div");
toastContainer.id = "challenge-toast";
document.body.appendChild(toastContainer);

// ─── Inject mailbox into nav ─────────────────────────────────────────────────
function injectMailbox() {
  const settingsWrap = document.querySelector(".settings-wrap");
  if (!settingsWrap || document.getElementById("mailbox-btn")) return;

  const wrap = document.createElement("div");
  wrap.className = "mailbox-wrap";
  wrap.innerHTML = `
    <button id="mailbox-btn" aria-label="Challenges">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
        <polyline points="22,6 12,13 2,6"/>
      </svg>
      <span id="mailbox-badge" class="hidden">0</span>
    </button>
    <div id="mailbox-dropdown" class="hidden">
      <div class="mailbox-header">⚔ Challenges</div>
      <div id="mailbox-list"><div class="mailbox-empty">No pending challenges</div></div>
    </div>
  `;

  settingsWrap.parentNode.insertBefore(wrap, settingsWrap);

  document.getElementById("mailbox-btn").addEventListener("click", e => {
    e.stopPropagation();
    document.getElementById("mailbox-dropdown").classList.toggle("hidden");
  });

  document.addEventListener("click", () => {
    const dd = document.getElementById("mailbox-dropdown");
    if (dd) dd.classList.add("hidden");
  });
}

// ─── Show a toast for an incoming challenge ───────────────────────────────────
function showChallengeToast(challengeId, fromUsername) {
  const card = document.createElement("div");
  card.className = "challenge-toast-card";
  card.dataset.challengeId = challengeId;
  card.innerHTML = `
    <div class="toast-header">
      <span class="toast-icon">⚔</span>
      <span class="toast-title">Challenge from ${fromUsername}</span>
    </div>
    <div class="toast-sub">Wants to play a game against you</div>
    <div class="toast-actions">
      <button class="toast-btn toast-btn-accept">Accept</button>
      <button class="toast-btn toast-btn-decline">Decline</button>
    </div>
    <div class="toast-progress"><div class="toast-progress-bar" id="pb-${challengeId}"></div></div>
  `;

  toastContainer.appendChild(card);

  // Progress bar countdown
  const bar = card.querySelector(`#pb-${challengeId}`);
  requestAnimationFrame(() => {
    bar.style.transition = `width ${DISMISS_DELAY}ms linear`;
    bar.style.width = "0%";
  });

  card.querySelector(".toast-btn-accept").onclick = () => {
    dismissToast(card);
    acceptChallenge(challengeId);
  };

  card.querySelector(".toast-btn-decline").onclick = () => {
    dismissToast(card);
    declineChallenge(challengeId);
  };

  const timer = setTimeout(() => dismissToast(card), DISMISS_DELAY);
  card._timer = timer;
}

function dismissToast(card) {
  clearTimeout(card._timer);
  card.classList.add("toast-out");
  card.addEventListener("animationend", () => card.remove(), { once: true });
}

// ─── Mailbox rendering ────────────────────────────────────────────────────────
function renderMailbox(challenges) {
  const listEl = document.getElementById("mailbox-list");
  const badge  = document.getElementById("mailbox-badge");
  if (!listEl || !badge) return;

  const entries = Object.entries(challenges || {});

  if (entries.length === 0) {
    listEl.innerHTML = `<div class="mailbox-empty">No pending challenges</div>`;
    badge.classList.add("hidden");
    return;
  }

  badge.textContent  = entries.length;
  badge.classList.remove("hidden");

  listEl.innerHTML = "";
  for (const [id, data] of entries) {
    const item = document.createElement("div");
    item.className = "mailbox-item";
    item.innerHTML = `
      <div class="mailbox-item-title">⚔ ${data.fromUsername}</div>
      <div class="mailbox-item-sub">Sent ${timeAgo(data.sentAt)}</div>
      <div class="mailbox-item-actions">
        <button class="toast-btn toast-btn-accept">Accept</button>
        <button class="toast-btn toast-btn-decline">Decline</button>
      </div>
    `;
    item.querySelector(".toast-btn-accept").onclick  = () => acceptChallenge(id);
    item.querySelector(".toast-btn-decline").onclick = () => declineChallenge(id);
    listEl.appendChild(item);
  }
}

// ─── Accept / Decline ─────────────────────────────────────────────────────────
async function acceptChallenge(challengeId) {
  const snap = await get(ref(db, `challenges/${myUid}/${challengeId}`));
  const data  = snap.val();
  if (!data) return;

  const { fromUid, fromUsername } = data;

  // Create game — challenger is white, accepter is black (random could be added)
  const gameRef = push(ref(db, "games"));
  const gameId  = gameRef.key;

  await set(gameRef, {
    white: { uid: fromUid, username: fromUsername },
    black: { uid: myUid,   username: myUsername  },
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    moves: [],
    status: "playing",
    createdAt: Date.now(),
    fromChallenge: true,
  });

  // Tell both players
  await set(ref(db, `users/${fromUid}/currentGame`), gameId);
  await set(ref(db, `users/${myUid}/currentGame`),   gameId);

  // Notify challenger
  await set(ref(db, `users/${fromUid}/challengeAccepted`), {
    gameId,
    byUsername: myUsername,
    at: Date.now(),
  });

  // Remove challenge
  await remove(ref(db, `challenges/${myUid}/${challengeId}`));

  // Redirect accepter
  window.location.href = `play.html?challenge=${gameId}&color=black`;
}

async function declineChallenge(challengeId) {
  await remove(ref(db, `challenges/${myUid}/${challengeId}`));
  renderMailboxFromDb();
}

// ─── Send a challenge (called from profile page) ──────────────────────────────
window.sendChallenge = async function(toUid, toUsername) {
  if (!myUid) return;

  const alreadySent = await get(ref(db, `challenges/${toUid}/${myUid}`));
  if (alreadySent.exists()) {
    showInfoToast("Challenge already sent!");
    return;
  }

  const challengeData = {
    fromUid:      myUid,
    fromUsername: myUsername,
    toUid,
    toUsername,
    sentAt: Date.now(),
  };

  await set(ref(db, `challenges/${toUid}/${myUid}`), challengeData);
  showInfoToast(`Challenge sent to ${toUsername}!`);
};

function showInfoToast(msg) {
  const card = document.createElement("div");
  card.className = "challenge-toast-card";
  card.style.borderLeftColor = "#4caf7d";
  card.innerHTML = `
    <div class="toast-header">
      <span class="toast-icon">✓</span>
      <span class="toast-title">${msg}</span>
    </div>
  `;
  toastContainer.appendChild(card);
  setTimeout(() => dismissToast(card), 2500);
}

// ─── Listen for incoming challenges ──────────────────────────────────────────
const seenChallenges = new Set();

function listenForChallenges(uid) {
  onValue(ref(db, `challenges/${uid}`), snap => {
    const data = snap.val() || {};
    renderMailbox(data);

    for (const [id, challenge] of Object.entries(data)) {
      if (!seenChallenges.has(id)) {
        seenChallenges.add(id);
        showChallengeToast(id, challenge.fromUsername);
      }
    }
  });

  // Listen for challenge accepted (so challenger gets redirected)
  onValue(ref(db, `users/${uid}/challengeAccepted`), snap => {
    if (!snap.exists()) return;
    const { gameId } = snap.val();
    remove(ref(db, `users/${uid}/challengeAccepted`));
    window.location.href = `play.html?challenge=${gameId}&color=white`;
  });
}

async function renderMailboxFromDb() {
  const snap = await get(ref(db, `challenges/${myUid}`));
  renderMailbox(snap.val() || {});
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60000)  return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function waitForNav(cb) {
  if (document.querySelector(".settings-wrap")) return cb();
  setTimeout(() => waitForNav(cb), 50);
}

onAuthStateChanged(auth, user => {
  if (!user) return;
  myUid = user.uid;

  get(ref(db, `users/${user.uid}/username`)).then(snap => {
    myUsername = snap.val() || user.email;
    waitForNav(() => {
      injectMailbox();
      listenForChallenges(user.uid);
    });
  });
});