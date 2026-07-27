#!/usr/bin/env node

import nodePath from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const EXPECTED_PROJECT = "faithchess";
export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TIME_CONTROL_SECONDS = Object.freeze({
  bullet: 60,
  blitz: 300,
  rapid: 600,
});

const USERNAME_KEY_FORBIDDEN_PATTERN = /[.#$\[\]\/\u0000-\u001F\u007F]/;
const UTF8_ENCODER = new TextEncoder();
const LEGACY_GAME_KEYS = new Set([
  "white",
  "black",
  "fen",
  "moves",
  "status",
  "timeControl",
  "whiteTime",
  "blackTime",
  "whiteTimeMs",
  "blackTimeMs",
  "activeColor",
  "clockUpdatedAt",
  "createdAt",
  "tournamentId",
  "challenge",
  "resigned",
  "drawOffer",
  "drawAccepted",
]);
const LEGACY_CHALLENGE_KEYS = new Set([
  "fromUid",
  "fromUsername",
  "toUid",
  "toUsername",
  "sentAt",
]);

export class MigrationInputError extends Error {
  constructor(message, code = "invalid-input") {
    super(message);
    this.name = "MigrationInputError";
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function stableStringify(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MigrationInputError("Non-finite numbers are not supported.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  throw new MigrationInputError("Unsupported value in Firebase snapshot.");
}

export function valuesEqual(left, right) {
  if (left === undefined || right === undefined) return left === right;
  try {
    return stableStringify(left) === stableStringify(right);
  } catch {
    return false;
  }
}

export function cloneFirebaseValue(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function pathSegments(path) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.endsWith("/")) {
    throw new MigrationInputError("Migration paths must be non-empty relative Firebase paths.");
  }
  const segments = path.split("/");
  if (segments.some(segment => !segment || /[.#$\[\]]/.test(segment))) {
    throw new MigrationInputError("A migration path contains an invalid Firebase key.");
  }
  return segments;
}

export function getAtPath(root, path) {
  let current = root;
  for (const segment of pathSegments(path)) {
    if (current === null || typeof current !== "object" || !hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

export function setAtPath(root, path, value) {
  const segments = pathSegments(path);
  let current = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = cloneFirebaseValue(value);
}

function assertOnlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter(key => !allowed.has(key));
  if (unknown.length > 0) {
    throw new MigrationInputError(`${label} has unsupported fields.`, "unsupported-fields");
  }
}

function canonicalUser(root, uid) {
  const user = root?.users?.[uid];
  const username = user?.username;
  const usernameKey = typeof username === "string" ? username.toLowerCase() : "";
  if (
    !isRecord(user)
    || typeof username !== "string"
    || username.length < 3
    || USERNAME_KEY_FORBIDDEN_PATTERN.test(usernameKey)
    || UTF8_ENCODER.encode(usernameKey).length > 768
    || root?.usernames?.[usernameKey] !== uid
  ) {
    throw new MigrationInputError("A referenced user account is missing or non-canonical.", "noncanonical-account");
  }
  return user;
}

function validatePlayer(root, player, label) {
  if (!isRecord(player)) {
    throw new MigrationInputError(`${label} player is missing.`, "invalid-player");
  }
  assertOnlyKeys(player, new Set(["uid", "username"]), `${label} player`);
  if (
    typeof player.uid !== "string"
    || player.uid.length < 1
    || player.uid.length > 128
    || typeof player.username !== "string"
  ) {
    throw new MigrationInputError(`${label} player is invalid.`, "invalid-player");
  }
  const account = canonicalUser(root, player.uid);
  if (account.username !== player.username) {
    throw new MigrationInputError(`${label} username is not canonical.`, "noncanonical-player");
  }
  return account;
}

export function contiguousSanMoves(rawMoves) {
  if (rawMoves === undefined) return [];
  if (rawMoves === null || (typeof rawMoves !== "object")) {
    throw new MigrationInputError("Legacy moves must be numeric SAN children.", "invalid-moves");
  }

  const keys = Object.keys(rawMoves);
  if (keys.length > 600) {
    throw new MigrationInputError("Legacy game exceeds the supported ply limit.", "invalid-moves");
  }

  for (let index = 0; index < keys.length; index += 1) {
    if (!hasOwn(rawMoves, String(index))) {
      throw new MigrationInputError("Legacy move keys are not contiguous from zero.", "noncontiguous-moves");
    }
  }
  if (keys.some(key => !/^(0|[1-9][0-9]{0,2})$/.test(key) || Number(key) >= keys.length)) {
    throw new MigrationInputError("Legacy move keys must be canonical numeric SAN indexes.", "noncontiguous-moves");
  }

  return keys.map((_, index) => {
    const san = rawMoves[String(index)];
    if (
      typeof san !== "string"
      || san.length < 1
      || san.length > 32
      || /[\u0000-\u001f\u007f]/.test(san)
    ) {
      throw new MigrationInputError("A legacy move is not a valid SAN string.", "invalid-moves");
    }
    return san;
  });
}

export function createChessJsReplay(ChessConstructor) {
  if (typeof ChessConstructor !== "function") {
    throw new MigrationInputError("A chess.js Chess constructor is required.", "missing-chess-js");
  }

  return moves => {
    const chess = new ChessConstructor();
    for (let index = 0; index < moves.length; index += 1) {
      let result;
      try {
        result = chess.move(moves[index], { strict: true });
      } catch {
        throw new MigrationInputError(`Illegal SAN at ply ${index}.`, "illegal-san");
      }
      if (!result) {
        throw new MigrationInputError(`Illegal SAN at ply ${index}.`, "illegal-san");
      }
    }

    const fen = chess.fen();
    const turn = chess.turn();
    if (typeof fen !== "string" || (turn !== "w" && turn !== "b")) {
      throw new MigrationInputError("chess.js returned an invalid replay result.", "invalid-replay");
    }
    return { fen, turn };
  };
}

function inferLegacyGameKind(game, root) {
  if (hasOwn(game, "tournamentId")) {
    if (typeof game.tournamentId !== "string" || game.tournamentId.length < 8 || game.tournamentId.length > 128) {
      throw new MigrationInputError("Legacy tournament id is invalid.", "invalid-tournament");
    }
    const tournament = root?.tournaments?.[game.tournamentId];
    if (!isRecord(tournament)) {
      throw new MigrationInputError("Legacy tournament game has no tournament.", "invalid-tournament");
    }
    return "tournament";
  }
  if (hasOwn(game, "challenge")) {
    if (
      !isRecord(game.challenge)
      || game.timeControl !== "rapid"
      || game.challenge.fromUid !== game.white?.uid
      || game.challenge.toUid !== game.black?.uid
    ) {
      throw new MigrationInputError("Legacy challenge metadata is invalid.", "invalid-challenge-marker");
    }
    assertOnlyKeys(game.challenge, new Set(["fromUid", "toUid"]), "Legacy challenge marker");
    return "challenge";
  }
  if (hasOwn(game, "timeControl")) return "queue";
  return "challenge";
}

function gameTimeControl(game, root, kind) {
  if (kind === "challenge") {
    if (
      hasOwn(game, "timeControl")
      && (game.timeControl !== "rapid" || !hasOwn(game, "challenge"))
    ) {
      throw new MigrationInputError("Legacy challenge unexpectedly has a time control.", "ambiguous-kind");
    }
    return "rapid";
  }

  const fromGame = game.timeControl;
  if (!hasOwn(TIME_CONTROL_SECONDS, fromGame)) {
    throw new MigrationInputError("Legacy game time control is invalid.", "invalid-time-control");
  }
  if (kind === "tournament") {
    const tournamentTimeControl = root.tournaments[game.tournamentId].timeControl;
    if (tournamentTimeControl !== fromGame) {
      throw new MigrationInputError("Tournament and game time controls differ.", "invalid-time-control");
    }
  }
  return fromGame;
}

function exactLegacyClocks(game, kind, timeControl, moveCount) {
  const hasWhite = hasOwn(game, "whiteTime");
  const hasBlack = hasOwn(game, "blackTime");
  const maximum = TIME_CONTROL_SECONDS[timeControl];

  if (!hasWhite && !hasBlack && kind === "challenge" && moveCount === 0) {
    return { white: maximum, black: maximum };
  }
  if (!hasWhite || !hasBlack) {
    throw new MigrationInputError("Both exact legacy clocks are required.", "missing-clock");
  }

  for (const [color, value] of [["white", game.whiteTime], ["black", game.blackTime]]) {
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
      throw new MigrationInputError(`Legacy ${color} clock is invalid.`, "invalid-clock");
    }
  }
  return { white: game.whiteTime, black: game.blackTime };
}

function validateOptionalGameState(game, replay, clocks, timeControl) {
  if (hasOwn(game, "challenge")) {
    if (
      !isRecord(game.challenge)
      || game.tournamentId !== undefined
      || game.timeControl !== "rapid"
    ) {
      throw new MigrationInputError("Legacy challenge metadata is invalid.", "invalid-challenge-marker");
    }
    assertOnlyKeys(game.challenge, new Set(["fromUid", "toUid"]), "Legacy challenge marker");
    if (
      game.challenge.fromUid !== game.white.uid
      || game.challenge.toUid !== game.black.uid
    ) {
      throw new MigrationInputError("Legacy challenge metadata is not canonical.", "invalid-challenge-marker");
    }
  }

  const clockMetadataKeys = ["whiteTimeMs", "blackTimeMs", "activeColor", "clockUpdatedAt"];
  const clockMetadataCount = clockMetadataKeys.filter(key => hasOwn(game, key)).length;
  if (clockMetadataCount !== 0 && clockMetadataCount !== clockMetadataKeys.length) {
    throw new MigrationInputError("Legacy millisecond clock metadata is partial.", "partial-clock-metadata");
  }
  if (clockMetadataCount === clockMetadataKeys.length) {
    const maximumMs = TIME_CONTROL_SECONDS[timeControl] * 1000;
    if (
      !Number.isInteger(game.whiteTimeMs)
      || game.whiteTimeMs < 0
      || game.whiteTimeMs > maximumMs
      || !Number.isInteger(game.blackTimeMs)
      || game.blackTimeMs < 0
      || game.blackTimeMs > maximumMs
      || Math.ceil(game.whiteTimeMs / 1000) !== clocks.white
      || Math.ceil(game.blackTimeMs / 1000) !== clocks.black
      || game.activeColor !== (replay.turn === "w" ? "white" : "black")
      || !Number.isFinite(game.clockUpdatedAt)
      || game.clockUpdatedAt < game.createdAt
    ) {
      throw new MigrationInputError("Legacy millisecond clock metadata is inconsistent.", "invalid-clock-metadata");
    }
  }

  if (hasOwn(game, "resigned") && game.resigned !== "white" && game.resigned !== "black") {
    throw new MigrationInputError("Legacy resignation state is invalid.", "invalid-game-state");
  }
  if (hasOwn(game, "drawOffer") && game.drawOffer !== "white" && game.drawOffer !== "black") {
    throw new MigrationInputError("Legacy draw offer is invalid.", "invalid-game-state");
  }
  if (hasOwn(game, "drawAccepted") && game.drawAccepted !== true) {
    throw new MigrationInputError("Legacy draw acceptance is invalid.", "invalid-game-state");
  }
}

export function buildLegacyGameMigration(root, gameId, game, replaySan) {
  if (!isRecord(game)) {
    throw new MigrationInputError("Legacy game is not an object.", "invalid-game");
  }
  if (
    hasOwn(game, "schemaVersion")
    || hasOwn(game, "kind")
    || hasOwn(game, "createdBy")
    || hasOwn(game, "position")
    || hasOwn(game, "clocks")
  ) {
    throw new MigrationInputError("Game has an existing or partial v2 schema.", "not-legacy");
  }
  assertOnlyKeys(game, LEGACY_GAME_KEYS, "Legacy game");
  if (game.status !== "playing" && game.status !== "finished") {
    throw new MigrationInputError("Legacy game status is invalid.", "invalid-status");
  }
  if (!Number.isFinite(game.createdAt) || game.createdAt < 0) {
    throw new MigrationInputError("Legacy game creation time is invalid.", "invalid-created-at");
  }
  if (game.white?.uid === game.black?.uid) {
    throw new MigrationInputError("A game cannot contain the same player twice.", "invalid-player");
  }

  const whiteAccount = validatePlayer(root, game.white, "White");
  const blackAccount = validatePlayer(root, game.black, "Black");
  if (game.status === "playing") {
    if (whiteAccount.currentGame !== gameId || blackAccount.currentGame !== gameId) {
      throw new MigrationInputError("Playing game currentGame pointers are not exact.", "current-game-mismatch");
    }
  }

  const kind = inferLegacyGameKind(game, root);
  const timeControl = gameTimeControl(game, root, kind);
  const moves = contiguousSanMoves(game.moves);
  if (typeof replaySan !== "function") {
    throw new MigrationInputError("A legal SAN replay function is required.", "missing-chess-js");
  }
  const replay = replaySan(moves);
  if (
    !isRecord(replay)
    || typeof replay.fen !== "string"
    || (replay.turn !== "w" && replay.turn !== "b")
  ) {
    throw new MigrationInputError("The SAN replay result is invalid.", "invalid-replay");
  }
  const expectedTurn = moves.length % 2 === 0 ? "w" : "b";
  if (replay.turn !== expectedTurn) {
    throw new MigrationInputError("The replay turn does not match the ply count.", "invalid-replay");
  }
  if (hasOwn(game, "fen")) {
    if (game.fen !== replay.fen) {
      throw new MigrationInputError("Legacy FEN does not exactly match SAN replay.", "fen-mismatch");
    }
  } else if (moves.length > 0 || replay.fen !== START_FEN) {
    throw new MigrationInputError("A moved legacy game must have an exact FEN.", "fen-mismatch");
  }

  const clocks = exactLegacyClocks(game, kind, timeControl, moves.length);
  validateOptionalGameState(game, replay, clocks, timeControl);
  const position = {
    ply: moves.length,
    turnUid: replay.turn === "w" ? game.white.uid : game.black.uid,
    fen: replay.fen,
  };
  if (moves.length > 0) position.lastMove = moves.at(-1);

  const migrated = {
    ...cloneFirebaseValue(game),
    schemaVersion: 2,
    kind,
    createdBy: kind === "challenge" ? game.black.uid : game.white.uid,
    white: cloneFirebaseValue(game.white),
    black: cloneFirebaseValue(game.black),
    status: game.status,
    timeControl,
    createdAt: game.createdAt,
    position,
    clocks,
  };
  if (kind === "tournament") migrated.tournamentId = game.tournamentId;

  if (
    !valuesEqual(migrated.moves, game.moves)
    || !valuesEqual(migrated.white, game.white)
    || !valuesEqual(migrated.black, game.black)
    || migrated.status !== game.status
  ) {
    throw new MigrationInputError("An immutable game field would change.", "immutable-field");
  }

  return {
    before: cloneFirebaseValue(game),
    after: migrated,
    accountGuards: [
      { path: `users/${game.white.uid}`, expected: cloneFirebaseValue(whiteAccount) },
      { path: `users/${game.black.uid}`, expected: cloneFirebaseValue(blackAccount) },
    ],
  };
}

function addGuard(guardMap, path, expected) {
  const serialized = stableStringify(expected);
  if (guardMap.has(path) && guardMap.get(path).serialized !== serialized) {
    throw new MigrationInputError("Conflicting transaction guards were planned.", "guard-conflict");
  }
  guardMap.set(path, {
    path,
    expected: cloneFirebaseValue(expected),
    serialized,
  });
}

function planLegacyChallenges(root, mutations, guardMap, skipped) {
  if (!hasOwn(root, "challenges")) return;
  if (!isRecord(root.challenges)) {
    skipped.push({
      type: "challenge",
      path: "challenges",
      code: "invalid-challenges-container",
    });
    return;
  }
  for (const [toUid, incoming] of Object.entries(root.challenges)) {
    if (!isRecord(incoming)) {
      skipped.push({
        type: "challenge",
        path: `challenges/${toUid}`,
        code: "invalid-challenges-container",
      });
      continue;
    }
    for (const [fromUid, challenge] of Object.entries(incoming)) {
      const path = `challenges/${toUid}/${fromUid}`;
      try {
        if (!isRecord(challenge)) {
          throw new MigrationInputError("Legacy challenge is not an object.", "invalid-challenge");
        }
        if (hasOwn(challenge, "state")) continue;
        assertOnlyKeys(challenge, LEGACY_CHALLENGE_KEYS, "Legacy challenge");
        if (
          challenge.fromUid !== fromUid
          || challenge.toUid !== toUid
          || !Number.isFinite(challenge.sentAt)
          || challenge.sentAt < 0
        ) {
          throw new MigrationInputError("Legacy challenge identifiers are not canonical.", "noncanonical-challenge");
        }
        const fromAccount = canonicalUser(root, fromUid);
        const toAccount = canonicalUser(root, toUid);
        if (
          challenge.fromUsername !== fromAccount.username
          || challenge.toUsername !== toAccount.username
        ) {
          throw new MigrationInputError("Legacy challenge usernames are not canonical.", "noncanonical-challenge");
        }

        const after = { ...cloneFirebaseValue(challenge), state: "open" };
        mutations.push({
          type: "challenge-open",
          path,
          before: cloneFirebaseValue(challenge),
          after,
        });
        addGuard(guardMap, path, challenge);
        addGuard(guardMap, `users/${fromUid}`, fromAccount);
        addGuard(guardMap, `users/${toUid}`, toAccount);
      } catch (error) {
        skipped.push({
          type: "challenge",
          path,
          code: error instanceof MigrationInputError ? error.code : "invalid-challenge",
        });
      }
    }
  }
}

function queueEntryAge(entry, now) {
  if (!isRecord(entry)) return null;
  const reference = Number.isFinite(entry.stateAt)
    ? entry.stateAt
    : Number.isFinite(entry.joinedAt)
      ? entry.joinedAt
      : null;
  return reference === null ? null : Math.max(0, now - reference);
}

function scanQueueBranch(queue, basePath, now, staleAfterMs, findings) {
  if (!isRecord(queue)) return;
  for (const [uid, entry] of Object.entries(queue)) {
    const path = `${basePath}/${uid}`;
    if (!isRecord(entry)) {
      findings.push({ path, code: "malformed-queue-entry", ageMs: null });
      continue;
    }
    const ageMs = queueEntryAge(entry, now);
    if (entry.state === undefined) {
      if (ageMs === null || ageMs >= staleAfterMs) {
        findings.push({ path, code: "stale-legacy-queue-entry", ageMs });
      }
      continue;
    }
    if (!["open", "claiming", "claimed"].includes(entry.state)) {
      findings.push({ path, code: "malformed-queue-state", ageMs });
      continue;
    }
    if (ageMs !== null && ageMs >= staleAfterMs) {
      findings.push({
        path,
        code: entry.state === "open" ? "stale-open-queue-entry" : "stale-queue-claim",
        ageMs,
      });
    }
  }
}

export function reportStaleQueues(root, options = {}) {
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (!Number.isFinite(now) || !Number.isFinite(staleAfterMs) || staleAfterMs < 1) {
    throw new MigrationInputError("Queue report timing options are invalid.");
  }

  const findings = [];
  if (isRecord(root?.queue)) {
    for (const [timeControl, queue] of Object.entries(root.queue)) {
      scanQueueBranch(queue, `queue/${timeControl}`, now, staleAfterMs, findings);
    }
  }
  if (isRecord(root?.tournaments)) {
    for (const [tournamentId, tournament] of Object.entries(root.tournaments)) {
      if (isRecord(tournament) && hasOwn(tournament, "queue")) {
        scanQueueBranch(
          tournament.queue,
          `tournaments/${tournamentId}/queue`,
          now,
          staleAfterMs,
          findings,
        );
      }
    }
  }
  return findings;
}

export function planLegacyMigration(rootValue, options = {}) {
  const root = isRecord(rootValue) ? rootValue : {};
  const replaySan = options.replaySan;
  if (typeof replaySan !== "function") {
    throw new MigrationInputError("Planning requires a chess.js-backed SAN replay function.", "missing-chess-js");
  }

  const mutations = [];
  const skipped = [];
  const legacyGameFindings = [];
  const guardMap = new Map();
  if (hasOwn(root, "games") && !isRecord(root.games)) {
    skipped.push({
      type: "game",
      path: "games",
      code: "invalid-games-container",
    });
  } else if (isRecord(root.games)) {
    for (const [gameId, game] of Object.entries(root.games)) {
      if (isRecord(game) && game.schemaVersion === 2) continue;
      const path = `games/${gameId}`;
      if (isRecord(game) && game.status === "finished") {
        legacyGameFindings.push({
          path,
          code: "finished-game-left-unchanged",
        });
        continue;
      }
      try {
        const planned = buildLegacyGameMigration(root, gameId, game, replaySan);
        mutations.push({
          type: "game-v2",
          path,
          before: planned.before,
          after: planned.after,
        });
        addGuard(guardMap, path, planned.before);
        for (const guard of planned.accountGuards) {
          addGuard(guardMap, guard.path, guard.expected);
        }
      } catch (error) {
        skipped.push({
          type: "game",
          path,
          code: error instanceof MigrationInputError ? error.code : "invalid-game",
        });
      }
    }
  }

  planLegacyChallenges(root, mutations, guardMap, skipped);
  const queueFindings = reportStaleQueues(root, options);
  const guards = [...guardMap.values()]
    .map(({ path, expected }) => ({ path, expected }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    version: 1,
    mutations,
    guards,
    skipped,
    legacyGameFindings,
    queueFindings,
    summary: {
      gameMigrations: mutations.filter(item => item.type === "game-v2").length,
      challengeMigrations: mutations.filter(item => item.type === "challenge-open").length,
      skippedGames: skipped.filter(item => item.type === "game").length,
      skippedChallenges: skipped.filter(item => item.type === "challenge").length,
      finishedLegacyGames: legacyGameFindings.length,
      staleQueueFindings: queueFindings.length,
    },
  };
}

export function migrationPlanSignature(plan) {
  return stableStringify({
    version: plan.version,
    mutations: plan.mutations,
    guards: plan.guards,
  });
}

export function applyPlanToRoot(currentRootValue, plan) {
  const currentRoot = isRecord(currentRootValue) ? currentRootValue : {};
  for (const guard of plan.guards ?? []) {
    if (!valuesEqual(getAtPath(currentRoot, guard.path), guard.expected)) {
      return { ok: false, code: "guard-mismatch", path: guard.path };
    }
  }
  for (const mutation of plan.mutations ?? []) {
    if (!valuesEqual(getAtPath(currentRoot, mutation.path), mutation.before)) {
      return { ok: false, code: "mutation-source-mismatch", path: mutation.path };
    }
  }

  const nextRoot = cloneFirebaseValue(currentRoot);
  for (const mutation of plan.mutations ?? []) {
    setAtPath(nextRoot, mutation.path, mutation.after);
  }
  return { ok: true, value: nextRoot };
}

export function verifyAppliedPlan(root, plan) {
  for (const mutation of plan.mutations ?? []) {
    if (!valuesEqual(getAtPath(root, mutation.path), mutation.after)) {
      return { ok: false, path: mutation.path };
    }
  }
  return { ok: true };
}

export function assertApplyPlanSafe(plan) {
  if ((plan.skipped ?? []).length > 0) {
    throw new MigrationInputError(
      "Apply is blocked while legacy games or challenges are skipped. Resolve every reported record first.",
      "skipped-records",
    );
  }
}

export function parseCliArgs(argv) {
  const result = {
    apply: false,
    project: null,
    backup: null,
    help: false,
    staleAfterMs: DEFAULT_STALE_AFTER_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      result.apply = true;
    } else if (argument === "--project") {
      result.project = argv[++index] ?? null;
    } else if (argument === "--backup") {
      result.backup = argv[++index] ?? null;
    } else if (argument === "--stale-after-ms") {
      result.staleAfterMs = Number(argv[++index]);
    } else if (argument === "--help" || argument === "-h") {
      result.help = true;
    } else {
      throw new MigrationInputError("An unknown command-line argument was supplied.", "unknown-argument");
    }
  }
  return result;
}

export function validateCliConfig(args, environment = process.env) {
  if (args.help) return null;
  if (args.project !== EXPECTED_PROJECT) {
    throw new MigrationInputError(`Pass --project ${EXPECTED_PROJECT} to confirm the target.`, "project-confirmation");
  }
  if (!Number.isFinite(args.staleAfterMs) || args.staleAfterMs < 1) {
    throw new MigrationInputError("--stale-after-ms must be a positive number.", "invalid-stale-time");
  }
  if (args.apply) {
    if (
      typeof args.backup !== "string"
      || !args.backup.endsWith(".firebase-backup.json")
    ) {
      throw new MigrationInputError(
        "--apply requires a new ignored --backup path ending in .firebase-backup.json.",
        "backup-required",
      );
    }
    const resolvedBackup = nodePath.resolve(args.backup);
    const relativeToRepo = nodePath.relative(REPO_ROOT, resolvedBackup);
    const insideRepo = relativeToRepo !== ""
      && !relativeToRepo.startsWith(`..${nodePath.sep}`)
      && relativeToRepo !== ".."
      && !nodePath.isAbsolute(relativeToRepo);
    if (insideRepo) {
      const backupDirectory = nodePath.join(REPO_ROOT, "firebase-backups");
      const relativeToBackupDirectory = nodePath.relative(backupDirectory, resolvedBackup);
      if (
        relativeToBackupDirectory === ""
        || relativeToBackupDirectory.startsWith(`..${nodePath.sep}`)
        || relativeToBackupDirectory === ".."
        || nodePath.isAbsolute(relativeToBackupDirectory)
      ) {
        throw new MigrationInputError(
          "Backups inside this repository must be under firebase-backups/.",
          "unsafe-backup-path",
        );
      }
    }
  } else if (args.backup !== null) {
    throw new MigrationInputError("--backup is only accepted together with --apply.", "unexpected-backup");
  }

  const databaseUrl = environment.FIREBASE_DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new MigrationInputError("FIREBASE_DATABASE_URL is required.", "database-url-required");
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new MigrationInputError("FIREBASE_DATABASE_URL is invalid.", "invalid-database-url");
  }
  const allowedHost = (
    parsed.hostname === `${EXPECTED_PROJECT}.firebaseio.com`
    || parsed.hostname === `${EXPECTED_PROJECT}-default-rtdb.firebaseio.com`
    || new RegExp(`^${EXPECTED_PROJECT}(?:-default-rtdb)?\\.[a-z0-9-]+\\.firebasedatabase\\.app$`).test(parsed.hostname)
  );
  if (
    parsed.protocol !== "https:"
    || !allowedHost
    || parsed.port !== ""
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new MigrationInputError("FIREBASE_DATABASE_URL does not match the confirmed project root.", "invalid-database-url");
  }
  return { databaseUrl };
}

function publicPlanReport(plan, mode) {
  return {
    mode,
    ...plan.summary,
    skipped: plan.skipped.map(({ type, path, code }) => ({ type, path, code })),
    historicalGames: plan.legacyGameFindings.map(({ path, code }) => ({ path, code })),
    staleQueues: plan.queueFindings.map(({ path, code, ageMs }) => ({ path, code, ageMs })),
  };
}

async function loadChessReplay() {
  let chessModule;
  try {
    chessModule = await import("chess.js");
  } catch {
    throw new MigrationInputError(
      "The CLI requires chess.js. Install it in the execution environment without changing this site bundle.",
      "missing-chess-js",
    );
  }
  const ChessConstructor = chessModule.Chess ?? chessModule.default?.Chess ?? chessModule.default;
  return createChessJsReplay(ChessConstructor);
}

function authHeadersObject(value) {
  if (value && typeof value.forEach === "function") {
    const output = {};
    value.forEach((headerValue, key) => {
      output[key] = headerValue;
    });
    return output;
  }
  return Object.fromEntries(Object.entries(value ?? {}));
}

export function createFirebaseRestClient(databaseUrl, getAuthHeaders, fetchImpl = globalThis.fetch) {
  if (typeof getAuthHeaders !== "function" || typeof fetchImpl !== "function") {
    throw new MigrationInputError("Authenticated REST dependencies are unavailable.", "missing-rest-client");
  }
  const base = databaseUrl.endsWith("/") ? databaseUrl : `${databaseUrl}/`;
  const endpoint = new URL(".json", base).href;

  async function request(method, options = {}) {
    const authHeaders = authHeadersObject(await getAuthHeaders(endpoint));
    const requestUrl = new URL(endpoint);
    if (options.export) requestUrl.searchParams.set("format", "export");
    if (options.silent) requestUrl.searchParams.set("print", "silent");
    const response = await fetchImpl(
      requestUrl.href,
      {
        method,
        headers: {
          ...authHeaders,
          ...(options.headers ?? {}),
        },
        body: options.body,
      },
    );
    return response;
  }

  return {
    async readRoot() {
      const response = await request("GET", {
        export: true,
        headers: { "X-Firebase-ETag": "true" },
      });
      if (!response.ok) {
        throw new MigrationInputError(
          `Firebase read failed with HTTP ${response.status}.`,
          "firebase-read-failed",
        );
      }
      const etag = response.headers.get("etag");
      if (typeof etag !== "string" || etag.length === 0) {
        throw new MigrationInputError("Firebase did not return an ETag.", "missing-etag");
      }
      return {
        value: (await response.json()) ?? {},
        etag,
      };
    },

    async writeRoot(value, etag) {
      const response = await request("PUT", {
        silent: true,
        headers: {
          "Content-Type": "application/json",
          "If-Match": etag,
        },
        body: JSON.stringify(value),
      });
      if (response.status === 412) {
        throw new MigrationInputError(
          "Firebase changed after the guarded read. Nothing was applied; rerun with a new backup path.",
          "etag-conflict",
        );
      }
      if (!response.ok) {
        throw new MigrationInputError(
          `Firebase write failed with HTTP ${response.status}.`,
          "firebase-write-failed",
        );
      }
    },
  };
}

async function loadAuthenticatedRest(databaseUrl) {
  let authModule;
  try {
    authModule = await import("google-auth-library");
  } catch {
    throw new MigrationInputError(
      "The CLI requires google-auth-library in the execution environment.",
      "missing-google-auth-library",
    );
  }
  const GoogleAuth = authModule.GoogleAuth ?? authModule.default?.GoogleAuth;
  if (typeof GoogleAuth !== "function") {
    throw new MigrationInputError("google-auth-library did not expose GoogleAuth.", "missing-google-auth-library");
  }
  const auth = new GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/firebase.database",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
  });
  const client = await auth.getClient();
  return createFirebaseRestClient(
    databaseUrl,
    url => client.getRequestHeaders(url),
  );
}

async function writeExclusiveBackup(path, value) {
  const [{ mkdir, writeFile }, pathModule] = await Promise.all([
    import("node:fs/promises"),
    import("node:path"),
  ]);
  const resolved = pathModule.resolve(path);
  await mkdir(pathModule.dirname(resolved), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function usage() {
  return [
    "Firebase legacy migration (dry-run by default)",
    "",
    "Dry run:",
    `  node scripts/firebase-legacy-migrate.mjs --project ${EXPECTED_PROJECT}`,
    "",
    "Apply after reviewing the dry run:",
    `  node scripts/firebase-legacy-migrate.mjs --apply --project ${EXPECTED_PROJECT} --backup firebase-backups/<new-name>.firebase-backup.json`,
    "",
    "Requires FIREBASE_DATABASE_URL, Application Default Credentials, chess.js, and google-auth-library.",
    "No queue entries are changed; stale queues are reported only.",
    "The backup contains private database data; protect its directory with appropriate OS access controls.",
  ].join("\n");
}

export async function runCli(
  argv = process.argv.slice(2),
  environment = process.env,
  dependencies = {},
) {
  const logger = dependencies.logger ?? console;
  const loadReplay = dependencies.loadChessReplay ?? loadChessReplay;
  const loadRest = dependencies.loadAuthenticatedRest ?? loadAuthenticatedRest;
  const writeBackup = dependencies.writeExclusiveBackup ?? writeExclusiveBackup;
  const now = dependencies.now ?? Date.now;
  const args = parseCliArgs(argv);
  if (args.help) {
    logger.log(usage());
    return;
  }
  const { databaseUrl } = validateCliConfig(args, environment);
  const replaySan = await loadReplay();
  const rest = await loadRest(databaseUrl);
  const planningNow = now();

  const initialRoot = (await rest.readRoot()).value;
  const plan = planLegacyMigration(initialRoot, {
    replaySan,
    now: planningNow,
    staleAfterMs: args.staleAfterMs,
  });
  logger.log(JSON.stringify(publicPlanReport(plan, args.apply ? "apply" : "dry-run"), null, 2));
  if (!args.apply) {
    logger.log("Dry run complete. No Firebase data was changed.");
    return;
  }

  assertApplyPlanSafe(plan);
  if (plan.mutations.length === 0) {
    logger.log("No eligible changes were found. Firebase data was not changed.");
    return;
  }

  const latest = await rest.readRoot();
  const latestPlan = planLegacyMigration(latest.value, {
    replaySan,
    now: planningNow,
    staleAfterMs: args.staleAfterMs,
  });
  assertApplyPlanSafe(latestPlan);
  if (migrationPlanSignature(latestPlan) !== migrationPlanSignature(plan)) {
    throw new MigrationInputError(
      "Migration targets changed before backup. Nothing was applied; rerun with a new backup path.",
      "reread-mismatch",
    );
  }

  await writeBackup(args.backup, latest.value);
  logger.log("Sensitive backup created before the write; protect it with appropriate OS access controls.");
  const applied = applyPlanToRoot(latest.value, plan);
  if (!applied.ok) {
    throw new MigrationInputError(
      `Guarded migration planning failed at ${applied.path}.`,
      "transaction-guard",
    );
  }
  await rest.writeRoot(applied.value, latest.etag);
  const verifiedRoot = (await rest.readRoot()).value;
  const verified = verifyAppliedPlan(verifiedRoot, plan);
  if (!verified.ok) {
    throw new MigrationInputError("Post-write verification failed.", "verification-failed");
  }
  logger.log(`Applied ${plan.mutations.length} ETag-guarded migration changes atomically.`);
}

function safeCliError(error) {
  if (error instanceof MigrationInputError) return `${error.code}: ${error.message}`;
  const code = typeof error?.code === "string" && /^[A-Za-z0-9_./-]{1,80}$/.test(error.code)
    ? error.code
    : "unexpected-error";
  return `${code}: Firebase migration failed without applying a confirmed result.`;
}

const invokedAsScript = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  runCli().catch(error => {
    console.error(safeCliError(error));
    process.exitCode = 1;
  });
}
