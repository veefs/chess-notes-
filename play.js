function waitForFirebase(cb) {
  if (window.firebaseDb) return cb();
  setTimeout(() => waitForFirebase(cb), 50);
}

waitForFirebase(() => {
  console.log("✅ Firebase connected", window.firebaseDb);
});