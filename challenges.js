import { getDatabase, ref, set, get, remove, onValue }
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

const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);

let myUid      = null;
let myUsername = null;

// ── Toast ───────────────────────────────────────────────────
function showToast(msg) {
  const el = document.createElement("div");
  el.style.cssText = `
    position:fixed;bottom:20px;right:20px;
    background:var(--bg2,#222);color:var(--text2,#fff);
    padding:10px 14px;border-radius:8px;z-index:9999;
    font-size:13px;border:1px solid var(--border,#333);
    font-family:'Outfit',sans-serif;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ── Update inbox UI ─────────────────────────────────────────
function updateInbox(challenges) {
  const listEl  = document.getElementById("inboxList");
  const badge   = document.getElementById("inboxBadge");
  if (!listEl || !badge) return;

  const entries = Object.entries(challenges);

  if (entries.length === 0) {
    badge.classList.add("hidden");
    listEl.innerHTML = `<div class="cog-item" style="color:var(--muted);font-size:13px;">No pending challenges</div>`;
    return;
  }

  badge.textContent = entries.length;
  badge.classList.remove("hidden");
  listEl.innerHTML = "";

  for (const [fromUid, data] of entries) {
    const item = document.createElement("div");
    item.style.cssText = "padding:10px 16px;border-bottom:1px solid var(--border);";
    item.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px;">⚔ ${data.fromUsername}</div>
      <div style="display:flex;gap:6px;">
        <button data-accept="${fromUid}" style="flex:1;padding:4px 8px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius,6px);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Accept</button>
        <button data-decline="${fromUid}" style="flex:1;padding:4px 8px;background:var(--bg4);color:var(--muted);border:none;border-radius:var(--radius,6px);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Decline</button>
      </div>
    `;
    item.querySelector("[data-accept]").onclick = e => {
      e.stopPropagation();
      acceptChallenge(fromUid, data);
    };
    item.querySelector("[data-decline]").onclick = e => {
      e.stopPropagation();
      declineChallenge(fromUid);
    };
    listEl.appendChild(item);
  }
}

// ── Send Challenge ──────────────────────────────────────────
window.sendChallenge = async function(toUid, toUsername) {
  if (!myUid) return;

  const already = await get(ref(db, `challenges/${toUid}/${myUid}`));
  if (already.exists()) { showToast("Already challenged"); return; }

  await set(ref(db, `challenges/${toUid}/${myUid}`), {
    fromUid:      myUid,
    fromUsername: myUsername,
    toUid,
    toUsername,
    sentAt:       Date.now(),
  });

  showToast(`Challenge sent to ${toUsername}!`);
};

// ── Accept Challenge ────────────────────────────────────────
async function acceptChallenge(fromUid, data) {
  const gameId = crypto.randomUUID();

  await set(ref(db, `games/${gameId}`), {
    white:     { uid: fromUid, username: data.fromUsername },
    black:     { uid: myUid,   username: myUsername },
    moves:     [],
    status:    "playing",
    createdAt: Date.now(),
  });

  await set(ref(db, `users/${fromUid}/currentGame`), gameId);
  await set(ref(db, `users/${myUid}/currentGame`),   gameId);
  await remove(ref(db, `challenges/${myUid}/${fromUid}`));

  window.location.href = `play.html?challenge=${gameId}&color=black`;
}

// ── Decline Challenge ───────────────────────────────────────
async function declineChallenge(fromUid) {
  await remove(ref(db, `challenges/${myUid}/${fromUid}`));
  showToast("Challenge declined");
}

// ── Listen for incoming challenges ──────────────────────────
function listenForChallenges(uid) {
  onValue(ref(db, `challenges/${uid}`), snap => {
    updateInbox(snap.val() || {});
  });
}

// ── Init ────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) return;
  myUid = user.uid;
  const snap = await get(ref(db, `users/${user.uid}/username`));
  myUsername = snap.val() || user.email;
  listenForChallenges(myUid);
});