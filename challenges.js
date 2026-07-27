import { getDatabase, ref, set, get, remove, onValue, push, runTransaction, update }
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
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

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

  const entries = Object.entries(challenges)
    .filter(([, data]) => data?.state === "open");

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

    const label = document.createElement("div");
    label.style.cssText = "font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px;";
    label.textContent = `⚔ ${String(data.fromUsername || "Unknown")}`;

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:6px;";

    const acceptButton = document.createElement("button");
    acceptButton.textContent = "Accept";
    acceptButton.style.cssText = "flex:1;padding:4px 8px;background:var(--accent);color:#fff;border:none;border-radius:var(--radius,6px);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;";

    const declineButton = document.createElement("button");
    declineButton.textContent = "Decline";
    declineButton.style.cssText = "flex:1;padding:4px 8px;background:var(--bg4);color:var(--muted);border:none;border-radius:var(--radius,6px);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;cursor:pointer;";

    acceptButton.onclick = async e => {
      e.stopPropagation();
      acceptButton.disabled = true;
      declineButton.disabled = true;
      const accepted = await acceptChallenge(fromUid);
      if (!accepted) {
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
      } catch {
        acceptButton.disabled = false;
        declineButton.disabled = false;
      }
    };

    actions.append(acceptButton, declineButton);
    item.append(label, actions);
    listEl.appendChild(item);
  }
}

async function migrateLegacyChallenges(uid, challenges) {
  const normalized = { ...challenges };
  const migrations = Object.entries(challenges).map(async ([fromUid, data]) => {
    if (
      !data
      || data.state !== undefined
      || data.fromUid !== fromUid
      || data.toUid !== uid
      || typeof data.fromUsername !== "string"
      || typeof data.toUsername !== "string"
      || !Number.isFinite(data.sentAt)
      || data.gameId !== undefined
      || data.acceptedGameId !== undefined
      || data.acceptedAt !== undefined
    ) {
      return;
    }

    try {
      await set(ref(db, `challenges/${uid}/${fromUid}/state`), "open");
      normalized[fromUid] = { ...data, state: "open" };
    } catch (error) {
      console.warn("Could not restore an older pending challenge:", error);
    }
  });
  await Promise.all(migrations);
  return normalized;
}

// ── Send Challenge ──────────────────────────────────────────
window.sendChallenge = async function(toUid, toUsername) {
  if (!myUid) return;

  const already = await get(ref(db, `challenges/${toUid}/${myUid}`));
  if (already.exists()) { showToast("Already challenged"); return; }

  const [fromNameSnap, toNameSnap] = await Promise.all([
    get(ref(db, `users/${myUid}/username`)),
    get(ref(db, `users/${toUid}/username`)),
  ]);
  const canonicalFromUsername = fromNameSnap.val();
  const canonicalToUsername = toNameSnap.val();
  if (
    typeof canonicalFromUsername !== "string"
    || typeof canonicalToUsername !== "string"
  ) {
    showToast("Could not verify both players");
    return;
  }

  await set(ref(db, `challenges/${toUid}/${myUid}`), {
    fromUid:      myUid,
    fromUsername: canonicalFromUsername,
    toUid,
    toUsername: canonicalToUsername,
    sentAt:       Date.now(),
    state:        "open",
  });

  showToast(`Challenge sent to ${canonicalToUsername}!`);
};

// ── Accept Challenge ────────────────────────────────────────
async function acceptChallenge(fromUid) {
  if (!myUid) return false;

  const challengeRef = ref(db, `challenges/${myUid}/${fromUid}`);
  const gameRef = push(ref(db, "games"));
  const gameId = gameRef.key;
  if (!gameId) {
    showToast("Could not reserve a game");
    return false;
  }

  let originalOpen = null;
  let challengeLocked = false;

  try {
    const [fromNameSnap, toNameSnap] = await Promise.all([
      get(ref(db, `users/${fromUid}/username`)),
      get(ref(db, `users/${myUid}/username`)),
    ]);
    const fromUsername = fromNameSnap.val();
    const toUsername = toNameSnap.val();
    if (typeof fromUsername !== "string" || typeof toUsername !== "string") {
      throw new Error("Could not verify both players.");
    }

    const acceptedAt = Date.now();
    const lock = await runTransaction(challengeRef, current => {
      if (
        !current
        || current.state !== "open"
        || current.fromUid !== fromUid
        || current.toUid !== myUid
        || current.fromUsername !== fromUsername
        || current.toUsername !== toUsername
      ) {
        return;
      }
      return {
        ...current,
        state: "accepted",
        gameId,
        acceptedAt,
      };
    });

    if (!lock.committed) {
      showToast("This challenge is no longer available");
      return false;
    }

    const accepted = lock.snapshot.val();
    originalOpen = {
      fromUid: accepted.fromUid,
      fromUsername: accepted.fromUsername,
      toUid: accepted.toUid,
      toUsername: accepted.toUsername,
      sentAt: accepted.sentAt,
      state: "open",
    };
    challengeLocked = true;

    await set(gameRef, {
      schemaVersion: 2,
      kind: "challenge",
      createdBy: myUid,
      white: { uid: fromUid, username: fromUsername },
      black: { uid: myUid, username: toUsername },
      status: "playing",
      timeControl: "rapid",
      createdAt: Date.now(),
      position: {
        ply: 0,
        turnUid: fromUid,
        fen: START_FEN,
      },
      clocks: {
        white: 600,
        black: 600,
      },
    });

    await update(ref(db), {
      [`users/${fromUid}/currentGame`]: gameId,
      [`users/${myUid}/currentGame`]: gameId,
    });

    // Once both pointers exist, an inbox cleanup failure must not reopen the match.
    try {
      await remove(challengeRef);
    } catch (cleanupError) {
      console.warn("Challenge cleanup failed after game creation:", cleanupError);
    }

    window.location.href = `play.html?challenge=${gameId}&color=black`;
    return true;
  } catch (error) {
    try {
      await remove(gameRef);
    } catch (cleanupError) {
      console.warn("Could not remove an unstarted challenge game:", cleanupError);
    }

    if (challengeLocked && originalOpen) {
      try {
        await runTransaction(challengeRef, current => {
          if (
            !current
            || current.state !== "accepted"
            || current.gameId !== gameId
          ) {
            return;
          }
          return originalOpen;
        });
      } catch (rollbackError) {
        console.error("Could not reopen the challenge:", rollbackError);
      }
    }
    console.error("Could not accept challenge:", error);
    showToast("Could not start the challenge game");
    return false;
  }
}

// ── Decline Challenge ───────────────────────────────────────
async function declineChallenge(fromUid) {
  await remove(ref(db, `challenges/${myUid}/${fromUid}`));
  showToast("Challenge declined");
}

// ── Listen for incoming challenges ──────────────────────────
function listenForChallenges(uid) {
  onValue(ref(db, `challenges/${uid}`), async snap => {
    const challenges = snap.val() || {};
    updateInbox(await migrateLegacyChallenges(uid, challenges));
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
