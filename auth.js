import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAUdXVlmN9xhhIzubK0MTtGO3hA9JkHClA",
  authDomain: "faithchess.firebaseapp.com",
  databaseURL: "https://faithchess-default-rtdb.firebaseio.com",
  projectId: "faithchess",
  storageBucket: "faithchess.firebasestorage.app",
  messagingSenderId: "132292001988",
  appId: "1:132292001988:web:3c9b7227f1b09766b48991"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

window.firebaseDb = db;
window.firebaseRef = ref;
window.firebaseSet = set;
window.firebaseOnValue = onValue;
window.firebaseAuth = auth;
window.firebaseSignOut = signOut;
window.firebaseOnAuthChanged = onAuthStateChanged;

const NAV_TITLES = {
  dev: { label: "DEV", color: "#74ebcb" },
  gm: { label: "GM", color: "#f0c040" },
  im: { label: "IM", color: "#aaaaaa" },
  fm: { label: "FM", color: "#d4956a" },
  cm: { label: "CM", color: "#7ecf7e" },
  nm: { label: "NM", color: "#7ab8e0" },
  mod: { label: "Mod", color: "#f08080" },
};

onAuthStateChanged(auth, async user => {
  const dropdown = document.getElementById("cogDropdown");
  const navUser = document.getElementById("navUsername");
  if (user) {
    const [usernameSnap, titleSnap] = await Promise.all([
      get(ref(db, `users/${user.uid}/username`)),
      get(ref(db, `users/${user.uid}/title`)),
    ]);
    const username = usernameSnap.val() || user.email;
    const avatarSnap = await get(ref(db, `users/${user.uid}/avatarUrl`));
    const avatarUrl = avatarSnap.val();
    window.myAvatarUrl = avatarUrl;
    const titleKey = titleSnap.val();
    const titleInfo = titleKey ? NAV_TITLES[titleKey] : null;
    const titleHTML = titleInfo
      ? ` <span style="font-size:10px;font-weight:700;color:${titleInfo.color};letter-spacing:.5px;">${titleInfo.label}</span>`
      : "";
    if (navUser) { navUser.textContent = username; navUser.classList.remove("hidden"); }
    if (dropdown) {
      dropdown.innerHTML = `
  <div class="cog-item cog-user">👤 ${username}${titleHTML}</div>
  <div class="cog-divider"></div>
  <div class="cog-item" onclick="window.location.href='settings.html'">Settings</div>
  <div class="cog-divider"></div>
  <div class="cog-item" id="signOutBtn">Sign Out</div>
`;
      document.getElementById("signOutBtn").onclick = () => signOut(auth).then(() => location.reload());
    }
  } else {
    if (navUser) navUser.classList.add("hidden");
    if (dropdown) dropdown.innerHTML = `
      <div class="cog-item" onclick="window.location.href='login.html';">Log In</div>
      <div class="cog-item" onclick="window.location.href='signup.html';">Sign Up</div>
    `;
  }
});