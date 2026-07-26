import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = file => readFileSync(join(root, file), "utf8");
let assertions = 0;

function matches(source, pattern, message) {
  assert.match(source, pattern, message);
  assertions += 1;
}

function excludes(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
  assertions += 1;
}

const nav = read("nav.js");
const styles = read("style.css");
const play = read("play.html");
const settings = read("settings.html");
const login = read("login.html");
const signup = read("signup.html");
const arena = read("arena.html");
const theory = read("theory.html");

matches(nav, /<nav class="nav" aria-label="Primary">/, "shared navigation must use a named nav landmark");
matches(nav, /<a class="logo" href="index\.html"/, "the logo must be a real home link");
matches(nav, /<a class="nav-item[\s\S]*?href="\$\{page\.href\}"/, "navigation items must be real links");
matches(nav, /aria-current="page"/, "the active route must be exposed to assistive technology");
matches(nav, /aria-expanded="false" aria-controls="inboxDropdown"/, "inbox disclosure state must be exposed");
matches(nav, /aria-expanded="false" aria-controls="cogDropdown"/, "account disclosure state must be exposed");
matches(nav, /event\.key !== "Escape"/, "dropdowns must support Escape");
matches(nav, /item\.matches\("a, button"\)/, "native injected account actions must retain native semantics");
excludes(nav, /<div class="nav-item/, "navigation items must not regress to clickable divs");
excludes(nav, /\sonclick=/, "the injected navigation must not rely on inline pointer-only handlers");

matches(styles, /:where\(a, button, input, select, textarea, \[tabindex\]\):focus-visible/, "interactive controls need a shared focus indicator");
matches(styles, /@media \(max-width: 900px\)[\s\S]*?\.nav[\s\S]*?overflow-x: auto/, "mobile navigation must scroll within its own row");
matches(styles, /\.board-grid\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/, "board cards must be shrinkable");
matches(styles, /\.puzzle-layout[\s\S]*?flex-direction: column/, "puzzle layout must stack on narrow screens");
matches(styles, /\.cog-item\s*\{[\s\S]*?width: 100%[\s\S]*?border: none/, "account buttons need link-compatible reset styling");
matches(styles, /\.nav-title-badge\s*\{/, "injected navigation badges need stable shared styling");

matches(play, /#board\s*\{\s*width: min\(960px, 100%\) !important/, "the play board must not force a 960px mobile width");
matches(play, /@media \(max-width: 900px\)[\s\S]*?\.play-wrap\s*\{[\s\S]*?flex-direction: column/, "the play layout must stack on narrow screens");
matches(play, /@media \(max-width: 900px\)[\s\S]*?\.right-panel\s*\{[\s\S]*?width: 100%/, "the play controls must fit the mobile viewport");

for (const [id, label] of [
  ["darkModeToggle", "Dark Mode"],
  ["boardTheme", "Board Theme"],
  ["pieceSet", "Piece Set"],
  ["soundToggle", "Sound Effects"],
  ["legalMovesToggle", "Show Legal Moves"],
  ["animationToggle", "Piece Animation"],
  ["emailNotifToggle", "Email Notifications"],
]) {
  matches(settings, new RegExp(`<label class="settings-label" for="${id}">${label}</label>`), `${label} must name its control`);
}
for (const id of ["darkModeToggle", "soundToggle", "legalMovesToggle", "animationToggle", "emailNotifToggle"]) {
  matches(settings, new RegExp(`<label class="toggle" for="${id}">`), `${id} must retain a clickable slider label`);
}
matches(settings, /\.toggle input \{[^}]*width: 100%; height: 100%/, "toggle inputs must cover the visible slider hit target");
matches(settings, /\.toggle input:focus-visible \+ \.toggle-slider/, "toggle focus must be visibly drawn on the slider");
matches(settings, /id="saveMsg" role="status" aria-live="polite"/, "settings save feedback must be announced");
matches(settings, /accept="image\/jpeg,image\/png"/, "avatar selection must advertise the supported MIME types");
matches(settings, /const ALLOWED_IMAGE_TYPES = new Set\(\["image\/jpeg", "image\/png"\]\)/, "avatar MIME types must be allowlisted");
matches(settings, /if \(!ALLOWED_IMAGE_TYPES\.has\(file\.type\)\)/, "avatar MIME must be checked before upload");
matches(settings, /if \(file\.size > MAX_AVATAR_BYTES\)/, "avatar size must be checked before upload");
matches(settings, /if \(!res\.ok\) throw new Error\("avatar_upload_failed"\)/, "avatar upload HTTP failures must be rejected");
matches(settings, /if \(isAllowedAvatarUrl\(savedAvatarUrl\)\)/, "stored avatar URLs must be validated before display");
matches(settings, /if \(!isAllowedAvatarUrl\(avatarUrl\)\) throw new Error\("invalid_avatar_url"\)/, "uploaded avatar URLs must be validated");
matches(settings, /msg\.textContent = "Upload failed\. Please try again\."/, "avatar failures must use a fixed user-safe message");
excludes(settings, /msg\.textContent = "Upload failed: " \+/, "remote avatar error details must not be echoed");

const avatarUrlSource = [
  settings.match(/const CLOUD_NAME\s*=\s*"[^"]+";/)?.[0],
  settings.slice(settings.indexOf("function isAllowedAvatarUrl"), settings.indexOf("const firebaseConfig")),
].join("\n");
const isAllowedAvatarUrl = Function(`${avatarUrlSource}; return isAllowedAvatarUrl;`)();
assert.equal(isAllowedAvatarUrl("https://res.cloudinary.com/dszgbkb1f/image/upload/v1/avatar.png"), true, "the configured HTTPS Cloudinary image path must be accepted");
assert.equal(isAllowedAvatarUrl("http://res.cloudinary.com/dszgbkb1f/image/upload/v1/avatar.png"), false, "non-HTTPS avatar URLs must be rejected");
assert.equal(isAllowedAvatarUrl("https://res.cloudinary.com.evil.example/dszgbkb1f/image/upload/avatar.png"), false, "lookalike Cloudinary hosts must be rejected");
assertions += 3;

matches(login, /<form class="auth-box" id="loginForm"/, "login controls must use a form");
matches(login, /<label for="emailInput">Email<\/label>/, "login email label must be associated");
matches(login, /autocomplete="username" required/, "login email must expose username autocomplete");
matches(login, /autocomplete="current-password" required/, "login password must expose current-password autocomplete");
matches(login, /loginForm"\)\.addEventListener\("submit"/, "login must support keyboard form submission");

matches(signup, /<form class="auth-box" id="signupForm"/, "signup controls must use a form");
matches(signup, /<label for="usernameInput">Username<\/label>/, "signup username label must be associated");
matches(signup, /pattern="\[A-Za-z0-9_\\-\]\{3,24\}"/, "signup username input must constrain database-path characters");
matches(signup, /autocomplete="email" required/, "signup email must expose email autocomplete");
matches(signup, /autocomplete="new-password" minlength="6" required/, "signup password must expose new-password autocomplete");
matches(signup, /signupForm"\)\.addEventListener\("submit"/, "signup must support keyboard form submission");
matches(signup, /const USERNAME_PATTERN = \/\^\[A-Za-z0-9_-\]\{3,24\}\$\//, "signup must validate usernames again before constructing a database path");
matches(signup, /if \(signupInFlight\) return;/, "signup must reject duplicate submissions");
matches(signup, /runTransaction\(usernameClaimRef, currentOwner =>/, "username ownership must be claimed transactionally");
matches(signup, /ownsUsernameClaim = claimResult\.committed && claimResult\.snapshot\.val\(\) === uid/, "signup must verify ownership of the committed username claim");
matches(signup, /await update\(ref\(db\), \{\s*\[`users\/\$\{uid\}`\]: \{/, "profile initialization must use one root update");
matches(signup, /currentOwner === createdUser\.uid \? null : undefined/, "rollback must release only the new user's own username claim");
matches(signup, /deleteUser\(createdUser\)\.catch/, "failed initialization must best-effort delete the newly created auth user");
excludes(signup, /get\(ref\(db, `usernames\//, "signup must not use a racy username availability read");

const usernamePatternLiteral = signup.match(/const USERNAME_PATTERN = (\/\^\[A-Za-z0-9_-\]\{3,24\}\$\/);/)?.[1];
const usernamePattern = Function(`return ${usernamePatternLiteral};`)();
assert.equal(usernamePattern.test("Knight_24"), true, "safe usernames must pass");
assert.equal(usernamePattern.test("../admin"), false, "database path traversal characters must fail");
assert.equal(usernamePattern.test("name.with.dot"), false, "Firebase-forbidden dots must fail");
assertions += 3;

matches(arena, /function escapeHTML\(value\)/, "Arena must escape database-backed text before HTML rendering");
const escapeFunctionSource = arena.slice(arena.indexOf("function escapeHTML"), arena.indexOf("function safeStatus"));
const arenaEscapeHTML = Function(`${escapeFunctionSource}; return escapeHTML;`)();
assert.equal(
  arenaEscapeHTML(`<img src=x onerror="alert('x')">&`),
  "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;&amp;",
  "Arena escaping must neutralize HTML-significant characters",
);
assertions += 1;
matches(arena, /const VALID_STATUSES = new Set\(\["waiting", "active", "finished"\]\)/, "Arena status classes must be allowlisted");
matches(arena, /escapeHTML\(t\.name \|\| "Arena"\)/, "tournament names must be escaped");
matches(arena, /escapeHTML\(p\.username \|\| "Player"\)/, "leaderboard usernames must be escaped");
excludes(arena, /\$\{p\.username\}/, "raw usernames must not enter Arena HTML");
matches(arena, /<form class="modal-box" id="createForm" role="dialog" aria-modal="true"/, "the create modal must expose dialog and form semantics");
matches(arena, /<label class="form-label" for="tName">Name<\/label>/, "the tournament name field must have an associated label");
matches(arena, /@media \(max-width: 850px\)[\s\S]*?\.arena-wrap[\s\S]*?flex-direction: column/, "Arena must stack on narrow screens");
matches(arena, /\.leaderboard-scroll \{ max-width: 100%; overflow-x: auto; \}/, "wide leaderboards must scroll within their panel");

const tryMatch = arena.slice(arena.indexOf("function tryMatch"), arena.indexOf("async function createTournamentGame"));
const transactionCallback = tryMatch.indexOf("runTransaction(");
assert.ok(tryMatch.indexOf("committedMatch = null;", transactionCallback) > transactionCallback, "transaction retry state must reset inside every callback attempt");
assertions += 1;
matches(tryMatch, /if \(!result\.committed \|\| !committedMatch\) return;/, "only the committed attempt may create a game");
excludes(tryMatch, /\blet matched\b/, "stale cross-attempt match state must not return");
matches(tryMatch, /Object\.entries\(queue\)/, "queue candidates must retain their trusted Firebase keys");
matches(tryMatch, /Object\.prototype\.hasOwnProperty\.call\(queue, callerUid\)/, "matching requires the caller's own keyed queue entry");
matches(tryMatch, /safeFirebaseKey\(candidate\.entry\.uid\) === candidate\.uid/, "a queue payload UID must equal its conservative safe key");
excludes(tryMatch, /Object\.values\(queue\)/, "queue matching must not discard trusted keys");

const safeKeyConstant = arena.match(/const SAFE_FIREBASE_KEY = \/\^[^;]+;/)?.[0];
const safeKeyFunction = arena.slice(arena.indexOf("function safeFirebaseKey"), arena.indexOf("let myUid"));
const safeFirebaseKey = Function(`${safeKeyConstant}\n${safeKeyFunction}; return safeFirebaseKey;`)();
assert.equal(safeFirebaseKey("uid_A-123"), "uid_A-123", "safe Firebase keys must pass unchanged");
assert.equal(safeFirebaseKey("../users/admin"), null, "path-like Firebase keys must be rejected");
assertions += 2;

const createGameSource = arena.slice(arena.indexOf("async function createTournamentGame"), arena.indexOf("async function requeuePlayers"));
matches(createGameSource, /await update\(ref\(db\), \{/, "game creation and notifications must use one atomic root update");
matches(createGameSource, /whiteTimeMs:\s+clockMs/, "new games must include the millisecond white clock");
matches(createGameSource, /blackTimeMs:\s+clockMs/, "new games must include the millisecond black clock");
matches(createGameSource, /activeColor:\s+"white"/, "new games must identify White as the active clock");
matches(createGameSource, /clockUpdatedAt: createdAt/, "new games must initialize clockUpdatedAt with createdAt");
matches(createGameSource, /\[`users\/\$\{safeWhiteUid\}\/currentGame`\]: gameId/, "the atomic update must assign White's current game");
matches(createGameSource, /\[`tournaments\/\$\{safeTournamentId\}\/matches\/\$\{safeBlackUid\}`\]: gameId/, "the atomic update must notify Black");
excludes(createGameSource, /await set\(gameRef/, "game creation must not perform a partial game write");
matches(arena, /const requeued = await requeuePlayers/, "failed atomic game creation must attempt safe requeue");
matches(arena, /await recoverSearchUI\(tournamentId/, "failed queue operations must recover the search UI");

const createTournamentSource = arena.slice(arena.indexOf('createForm.addEventListener("submit"'), arena.indexOf("</script>", arena.indexOf('createForm.addEventListener("submit"')));
matches(createTournamentSource, /await update\(ref\(db\), \{[\s\S]*?\[`tournaments\/\$\{tournamentId\}`\]: \{/, "tournament and creator membership must use one root update");
matches(createTournamentSource, /players: \{\s*\[creatorUid\]: \{/, "the atomic tournament payload must include creator membership");

matches(theory, /--preferred-sq:\s*56px/, "Theory must separate user preference from rendered square size");
matches(theory, /--sq:\s*min\(var\(--preferred-sq\), 56px\)/, "Theory's default square size must be viewport-capped");
matches(theory, /\.app \{[^}]*grid-template-columns: 230px minmax\(0, 1fr\)/, "Theory content grid must be allowed to shrink");
matches(theory, /@media \(max-width: 768px\)[\s\S]*?--sq: min\(var\(--preferred-sq\), 42px, calc\(12\.5vw - 5\.75px\)\)/, "Theory board squares must be capped to the mobile content width");
matches(theory, /setProperty\('--preferred-sq', s\.sq \+ 'px'\)/, "Theory settings must update the preference without bypassing responsive caps");
excludes(theory, /setProperty\('--sq', s\.sq \+ 'px'\)/, "Theory settings must not override the responsive square size");
matches(theory, /probe\.style\.cssText='[^']*width:var\(--sq\)/, "Theory JavaScript must measure the resolved responsive square length");
excludes(theory, /parse(?:Int|Float)\(getComputedStyle\(document\.documentElement\)\.getPropertyValue\('--sq'\)\)/, "Theory must not parse unresolved CSS math as a number");
matches(theory, /target="_blank" rel="noopener noreferrer" class="hbtn"/, "Theory external links opened in a new tab must isolate the opener");

const buildEntrySource = theory.slice(theory.indexOf("function buildEntry(entry"), theory.indexOf("// ─── Tree nav"));
matches(buildEntrySource, /date\.textContent=String\(entry\.date\|\|''\)/, "imported entry dates must render as text");
matches(buildEntrySource, /styledTagClasses=new Set\(\['opening','tactics','endgame'\]\)/, "entry tag style classes must be allowlisted");
matches(buildEntrySource, /tag\.textContent=tagText/, "imported entry tags must render as text");
excludes(buildEntrySource, /\.innerHTML\s*=/, "entry headers must not interpolate imported JSON into HTML");

const renderEcoSource = theory.slice(theory.indexOf("function renderEcoList"), theory.indexOf("async function ensureEcoList"));
matches(renderEcoSource, /titleEl\.textContent = title/, "remote ECO names and codes must render as text");
matches(renderEcoSource, /countEl\.textContent = countLabel/, "ECO result metadata must render as text");
excludes(renderEcoSource, /card\.innerHTML\s*=/, "remote ECO fields must not be interpolated into HTML");

console.log(`ui-smoke: ${assertions} assertions passed`);
