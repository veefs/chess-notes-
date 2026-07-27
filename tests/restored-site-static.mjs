import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";

function checkJavaScript(args, input) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    input,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

const entries = await readdir(".", { withFileTypes: true });
const scripts = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => entry.name)
  .sort();

for (const script of scripts) checkJavaScript(["--check", script]);

let inlineScripts = 0;
for (const entry of entries.filter(
  (candidate) => candidate.isFile() && candidate.name.endsWith(".html"),
)) {
  const html = await readFile(entry.name, "utf8");
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] || "";
    const source = match[2] || "";
    if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;
    const args = ["--check"];
    if (/\btype\s*=\s*["']module["']/i.test(attributes)) {
      args.push("--input-type=module");
    }
    checkJavaScript(args, source);
    inlineScripts += 1;
  }
}

const [index, nav, login, signup, profile, theory] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("nav.js", "utf8"),
  readFile("login.html", "utf8"),
  readFile("signup.html", "utf8"),
  readFile("profile.html", "utf8"),
  readFile("theory.html", "utf8"),
]);

assert.match(index, /auth\.js/);
assert.match(nav, /login\.html/);
assert.match(login, /signInWithEmailAndPassword/);
assert.match(signup, /createUserWithEmailAndPassword/);
assert.match(signup, /runTransaction\s*\(/);
assert.match(signup, /deleteUser\s*\(/);
assert.match(signup, /await update\(ref\(db,\s*`users\/\$\{uid\}`\)/);
assert.match(profile, /friendRequests/);
assert.doesNotMatch(theory, /discord(?:app)?\.com\/api\/webhooks/i);
assert.doesNotMatch(theory, /\bWEBHOOK_URL\b/);

console.log(
  `restored site static checks passed: ${scripts.length} scripts, ` +
    `${inlineScripts} inline scripts`,
);
