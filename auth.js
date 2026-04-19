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

onAuthStateChanged(auth, async user => {
  const dropdown = document.getElementById("cogDropdown");
  const navUser = document.getElementById("navUsername");
  if (user) {
    const snap = await get(ref(db, `users/${user.uid}/username`));
    const username = snap.val() || user.email;
    if (navUser) { navUser.textContent = username; navUser.classList.remove("hidden"); }
    if (dropdown) {
      dropdown.innerHTML = `
  <div class="cog-item cog-user">👤 ${username}</div>
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