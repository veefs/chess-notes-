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

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db  = getDatabase(app);
const auth = getAuth(app);

// ─── State ─────────────────────────────────────────────────
let myUid = null;
let myUsername = null;

// ─── Toast container ───────────────────────────────────────
const toastContainer = document.createElement("div");
toastContainer.id = "challenge-toast";
document.body.appendChild(toastContainer);

// ─── Simple toast ──────────────────────────────────────────
function showToast(msg) {
  const el = document.createElement("div");
  el.style = `
    position:fixed;bottom:20px;right:20px;
    background:#222;color:#fff;padding:10px 14px;
    border-radius:8px;z-index:9999;font-size:13px;
  `;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ─── Challenge Toast (Accept/Decline) ──────────────────────
function showChallengeToast(fromUid, fromUsername) {
  const card = document.createElement("div");
  card.style = `
    position:fixed;bottom:20px;right:20px;
    background:#1e1e1e;color:#fff;padding:16px;
    border-radius:10px;z-index:9999;width:260px;
    box-shadow:0 8px 24px rgba(0,0,0,.6);
    font-family:sans-serif;
  `;

  card.innerHTML = `
    <div style="font-weight:700;margin-bottom:8px;">
      ⚔ Challenge from ${fromUsername}
    </div>
    <div style="display:flex;gap:8px;">
      <button id="acceptBtn" style="flex:1;">Accept</button>
      <button id="declineBtn" style="flex:1;">Decline</button>
    </div>
  `;

  document.body.appendChild(card);

  card.querySelector("#acceptBtn").onclick = () => {
    card.remove();
    acceptChallenge(fromUid);
  };

  card.querySelector("#declineBtn").onclick = () => {
    card.remove();
    declineChallenge(fromUid);
  };

  setTimeout(() => card.remove(), 8000);
}

// ─── Send Challenge (USED BY PROFILE PAGE) ─────────────────
window.sendChallenge = async function(toUid, toUsername) {
  if (!myUid) return;

  const already = await get(ref(db, `challenges/${toUid}/${myUid}`));
  if (already.exists()) {
    showToast("Already challenged");
    return;
  }

  await set(ref(db, `challenges/${toUid}/${myUid}`), {
    fromUid: myUid,
    fromUsername: myUsername,
    toUid,
    toUsername,
    sentAt: Date.now()
  });

  showToast(`Challenge sent to ${toUsername}`);
};

// ─── Accept Challenge ──────────────────────────────────────
async function acceptChallenge(fromUid) {
  const snap = await get(ref(db, `challenges/${myUid}/${fromUid}`));
  const data = snap.val();
  if (!data) return;

  const gameId = crypto.randomUUID();

  await set(ref(db, `games/${gameId}`), {
    white: { uid: fromUid, username: data.fromUsername },
    black: { uid: myUid, username: myUsername },
    moves: [],
    status: "playing",
    createdAt: Date.now()
  });

  await set(ref(db, `users/${fromUid}/currentGame`), gameId);
  await set(ref(db, `users/${myUid}/currentGame`), gameId);

  await remove(ref(db, `challenges/${myUid}/${fromUid}`));

  window.location.href = `play.html?challenge=${gameId}&color=black`;
}

// ─── Decline Challenge ─────────────────────────────────────
async function declineChallenge(fromUid) {
  await remove(ref(db, `challenges/${myUid}/${fromUid}`));
}

// ─── Listen for Challenges ─────────────────────────────────
const seen = new Set();

function listen(uid) {
  onValue(ref(db, `challenges/${uid}`), snap => {
    const data = snap.val() || {};

    for (const [fromUid, challenge] of Object.entries(data)) {
      if (!seen.has(fromUid)) {
        seen.add(fromUid);
        showChallengeToast(fromUid, challenge.fromUsername);
      }
    }
  });
}

// ─── Init ──────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user) return;

  myUid = user.uid;

  const snap = await get(ref(db, `users/${user.uid}/username`));
  myUsername = snap.val() || user.email;

  listen(myUid);
});
