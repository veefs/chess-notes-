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

const CLOUDINARY_AVATAR_PATH_PREFIX = "/dszgbkb1f/image/upload/";

function clearElement(element) {
  if (element) element.replaceChildren();
}

function addDivider(parent) {
  const divider = document.createElement("div");
  divider.className = "cog-divider";
  divider.setAttribute("role", "separator");
  parent.appendChild(divider);
}

function addMenuLink(parent, label, href) {
  const link = document.createElement("a");
  link.className = "cog-item";
  link.href = href;
  link.setAttribute("role", "menuitem");
  link.textContent = label;
  parent.appendChild(link);
  return link;
}

function safeAvatarUrl(value) {
  if (
    typeof value !== "string"
    || !value
    || value.length > 2048
    || value.trim() !== value
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "res.cloudinary.com"
      && !url.username
      && !url.password
      && !url.port
      && url.pathname.startsWith(CLOUDINARY_AVATAR_PATH_PREFIX)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

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
    const avatarUrl = safeAvatarUrl(avatarSnap.val());
    window.myAvatarUrl = avatarUrl;
    const titleKey = titleSnap.val();
    const titleInfo = titleKey ? NAV_TITLES[titleKey] : null;
    if (navUser) { navUser.textContent = username; navUser.classList.remove("hidden"); }
    if (dropdown) {
      clearElement(dropdown);

      const userItem = document.createElement("div");
      userItem.className = "cog-item cog-user";
      userItem.textContent = `👤 ${username}`;
      if (titleInfo) {
        const title = document.createElement("span");
        title.className = "nav-title-badge";
        title.style.color = titleInfo.color;
        title.textContent = titleInfo.label;
        userItem.append(" ", title);
      }
      dropdown.appendChild(userItem);
      addDivider(dropdown);
      addMenuLink(dropdown, "Settings", "settings.html");
      addDivider(dropdown);

      const signOutButton = document.createElement("button");
      signOutButton.type = "button";
      signOutButton.className = "cog-item cog-action";
      signOutButton.id = "signOutBtn";
      signOutButton.setAttribute("role", "menuitem");
      signOutButton.textContent = "Sign Out";
      signOutButton.addEventListener("click", () =>
        signOut(auth).then(() => location.reload())
      );
      dropdown.appendChild(signOutButton);
    }
  } else {
    if (navUser) navUser.classList.add("hidden");
    if (dropdown) {
      clearElement(dropdown);
      addMenuLink(dropdown, "Log In", "login.html");
      addMenuLink(dropdown, "Sign Up", "signup.html");
    }
  }
});
