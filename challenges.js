import { getDatabase, ref, get, onValue, update, runTransaction }
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

const RESERVED_FIREBASE_SEGMENTS = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

function isSafeFirebaseSegment(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && !RESERVED_FIREBASE_SEGMENTS.has(value)
    && !/[.#$/\[\]\u0000-\u001F\u007F]/.test(value);
}

function displayName(value, fallback = "Player") {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 80)
    : fallback;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isChallengeRecord(value, fromUid, toUid) {
  return isRecord(value)
    && value.fromUid === fromUid
    && value.toUid === toUid
    && (
      value.acceptedGameId == null
      || isSafeFirebaseSegment(value.acceptedGameId)
    );
}

function challengeGameMatches(value, fromUid, toUid) {
  return isRecord(value)
    && value.white?.uid === fromUid
    && value.black?.uid === toUid
    && value.challenge?.fromUid === fromUid
    && value.challenge?.toUid === toUid;
}

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

  const entries = Object.entries(challenges).filter(([fromUid, data]) =>
    isSafeFirebaseSegment(fromUid)
      && isChallengeRecord(data, fromUid, myUid)
  );

  if (entries.length === 0) {
    badge.classList.add("hidden");
    listEl.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "cog-item cog-empty";
    empty.textContent = "No pending challenges";
    listEl.appendChild(empty);
    return;
  }

  badge.textContent = entries.length;
  badge.classList.remove("hidden");
  listEl.replaceChildren();

  for (const [fromUid, data] of entries) {
    const item = document.createElement("div");
    item.style.cssText = "padding:10px 16px;border-bottom:1px solid var(--border);";

    const label = document.createElement("div");
    label.style.cssText = "font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px;";
    label.textContent = `⚔ ${displayName(data.fromUsername)}`;

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;";

    const acceptButton = document.createElement("button");
    acceptButton.type = "button";
    acceptButton.textContent = "Accept";
    acceptButton.style.cssText = "flex:1;padding:4px 8px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius,6px);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;";

    const declineButton = document.createElement("button");
    declineButton.type = "button";
    declineButton.textContent = "Decline";
    declineButton.style.cssText = "flex:1;padding:4px 8px;background:var(--bg4);color:var(--muted);border:none;border-radius:var(--radius,6px);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;";

    acceptButton.onclick = async e => {
      e.stopPropagation();
      acceptButton.disabled = true;
      declineButton.disabled = true;
      acceptButton.textContent = "Accepting…";
      try {
        await acceptChallenge(fromUid, data);
      } finally {
        acceptButton.textContent = "Accept";
        acceptButton.disabled = false;
        declineButton.disabled = false;
      }
    };
    declineButton.onclick = async e => {
      e.stopPropagation();
      acceptButton.disabled = true;
      declineButton.disabled = true;
      try {
        await declineChallenge(fromUid);
      } finally {
        acceptButton.disabled = false;
        declineButton.disabled = false;
      }
    };

    actions.append(acceptButton, declineButton);
    item.append(label, actions);
    listEl.appendChild(item);
  }
}

// ── Send Challenge ──────────────────────────────────────────
window.sendChallenge = async function(toUid, toUsername) {
  if (!isSafeFirebaseSegment(myUid) || !isSafeFirebaseSegment(toUid)) {
    showToast("Unable to send this challenge");
    return false;
  }

  try {
    const challengeRef = ref(db, `challenges/${toUid}/${myUid}`);
    const challenge = {
      fromUid:      myUid,
      fromUsername: displayName(myUsername),
      toUid,
      toUsername: displayName(toUsername),
      sentAt:       Date.now(),
    };
    const result = await runTransaction(challengeRef, current => {
      if (current == null) return challenge;
      return;
    }, { applyLocally: false });
    if (!result.committed) {
      showToast("Already challenged");
      return false;
    }

    showToast(`Challenge sent to ${displayName(toUsername)}!`);
    return true;
  } catch {
    showToast("The challenge could not be sent. Try again.");
    return false;
  }
};

async function claimChallenge(fromUid, toUid, candidateGameId) {
  const challengeRef = ref(db, `challenges/${toUid}/${fromUid}`);
  const acceptedAt = Date.now();
  const result = await runTransaction(challengeRef, current => {
    if (!isChallengeRecord(current, fromUid, toUid)) return;
    if (current.acceptedGameId) return current;
    return {
      ...current,
      acceptedGameId: candidateGameId,
      acceptedAt,
    };
  }, { applyLocally: false });
  const claimed = result.snapshot.val();

  return result.committed
    && isChallengeRecord(claimed, fromUid, toUid)
    && isSafeFirebaseSegment(claimed.acceptedGameId)
    ? claimed
    : null;
}

function buildChallengeGame(claimed, fromUid, toUid) {
  const seconds = 600;
  const createdAt = Date.now();
  return {
    white: { uid: fromUid, username: displayName(claimed.fromUsername) },
    black: { uid: toUid, username: displayName(myUsername) },
    challenge: { fromUid, toUid },
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    moves: [],
    status: "playing",
    timeControl: "rapid",
    whiteTime: seconds,
    blackTime: seconds,
    whiteTimeMs: seconds * 1000,
    blackTimeMs: seconds * 1000,
    activeColor: "white",
    clockUpdatedAt: createdAt,
    createdAt,
  };
}

async function createChallengeGame(gameId, gameData, fromUid, toUid) {
  const result = await runTransaction(ref(db, `games/${gameId}`), current => {
    if (current == null) return gameData;
    return;
  }, { applyLocally: false });
  const storedGame = result.snapshot.val();

  return challengeGameMatches(storedGame, fromUid, toUid);
}

// ── Accept Challenge ────────────────────────────────────────
async function acceptChallenge(fromUid, data) {
  if (
    !isSafeFirebaseSegment(fromUid)
    || !isSafeFirebaseSegment(myUid)
    || !isChallengeRecord(data, fromUid, myUid)
  ) {
    showToast("Unable to accept this challenge");
    return false;
  }

  try {
    const candidateGameId = crypto.randomUUID();
    if (!isSafeFirebaseSegment(candidateGameId)) {
      showToast("Unable to create this game");
      return false;
    }

    const claimed = await claimChallenge(fromUid, myUid, candidateGameId);
    if (!claimed) {
      showToast("This challenge is no longer available.");
      return false;
    }

    const gameId = claimed.acceptedGameId;
    const gameData = buildChallengeGame(claimed, fromUid, myUid);
    const gameReady = await createChallengeGame(
      gameId,
      gameData,
      fromUid,
      myUid,
    );
    if (!gameReady) {
      showToast("The claimed game could not be validated. Try again.");
      return false;
    }

    const updates = {
      [`users/${fromUid}/currentGame`]: gameId,
      [`users/${myUid}/currentGame`]: gameId,
      [`challenges/${myUid}/${fromUid}`]: null,
    };
    await update(ref(db), updates);
    window.location.href = `play.html?challenge=${encodeURIComponent(gameId)}`;
    return true;
  } catch {
    showToast("The challenge could not be accepted. Try again.");
    return false;
  }
}

// ── Decline Challenge ───────────────────────────────────────
async function declineChallenge(fromUid) {
  if (!isSafeFirebaseSegment(fromUid) || !isSafeFirebaseSegment(myUid)) {
    return false;
  }

  try {
    const result = await runTransaction(
      ref(db, `challenges/${myUid}/${fromUid}`),
      current => {
        if (!isChallengeRecord(current, fromUid, myUid)) return;
        if (current.acceptedGameId) return;
        return null;
      },
      { applyLocally: false },
    );
    if (!result.committed) {
      showToast("This challenge is already being accepted.");
      return false;
    }
    showToast("Challenge declined");
    return true;
  } catch {
    showToast("The challenge could not be declined. Try again.");
    return false;
  }
}

// ── Listen for incoming challenges ──────────────────────────
function listenForChallenges(uid) {
  onValue(ref(db, `challenges/${uid}`), snap => {
    updateInbox(snap.val() || {});
  });
}

// ── Init ────────────────────────────────────────────────────
onAuthStateChanged(auth, async user => {
  if (!user || !isSafeFirebaseSegment(user.uid)) return;
  myUid = user.uid;
  const snap = await get(ref(db, `users/${user.uid}/username`));
  myUsername = snap.val() || user.email;
  listenForChallenges(myUid);
});
