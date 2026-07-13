#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveSpriteName } from "./workbench-core.mjs";

const envPath = join(process.cwd(), ".env.local");
const remoteAppDir =
  process.env.WORKBENCH_REMOTE_APP_DIR || "/home/sprite/app";
const spriteName = resolveSpriteName();

if (!spriteName) {
  console.error(
    "Error: could not resolve a Sprite. Set SPRITE_NAME or add a .sprite file."
  );
  process.exit(2);
}

function readLocalEnv() {
  try {
    return readFileSync(envPath, "utf8");
  } catch (err) {
    if (err && typeof err === "object" && err.code === "ENOENT") return "";
    throw err;
  }
}

function readValue(text, key) {
  const match = text.match(new RegExp(`^${key}=(.+)$`, "m"));
  return match?.[1]?.trim() || null;
}

function upsert(text, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, line);
  return `${text.trimEnd()}${text.trim() ? "\n" : ""}${line}\n`;
}

try {
  const existing = readLocalEnv();
  const adminToken =
    readValue(existing, "WORKBENCH_ADMIN_TOKEN") ||
    randomBytes(32).toString("hex");
  const ingestToken =
    readValue(existing, "WORKBENCH_INGEST_TOKEN") ||
    randomBytes(32).toString("hex");
  const updated = upsert(
    upsert(existing, "WORKBENCH_ADMIN_TOKEN", adminToken),
    "WORKBENCH_INGEST_TOKEN",
    ingestToken
  );
  writeFileSync(envPath, updated, { encoding: "utf8", mode: 0o600 });
  chmodSync(envPath, 0o600);

  const nodeLookup = spawnSync(
    "sprite",
    ["exec", "-s", spriteName, "--", "/usr/bin/which", "node"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }
  );
  if (nodeLookup.error) throw nodeLookup.error;
  const remoteNode = nodeLookup.stdout.trim();
  if (nodeLookup.status !== 0 || !remoteNode.startsWith("/")) {
    throw new Error("Could not resolve the remote Node executable.");
  }

  const remoteWriter = String.raw`
const fs = require("node:fs");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  const { path, adminToken, ingestToken } = JSON.parse(input);
  let text = "";
  try { text = fs.readFileSync(path, "utf8"); }
  catch (err) { if (err.code !== "ENOENT") throw err; }
  const upsert = (source, key, value) => {
    const line = key + "=" + value;
    const pattern = new RegExp("^" + key + "=.*$", "m");
    return pattern.test(source)
      ? source.replace(pattern, line)
      : source.trimEnd() + (source.trim() ? "\n" : "") + line + "\n";
  };
  text = upsert(text, "WORKBENCH_ADMIN_TOKEN", adminToken);
  text = upsert(text, "WORKBENCH_INGEST_TOKEN", ingestToken);
  fs.writeFileSync(path, text, { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(path, 0o600);
});`;
  const remotePath = `${remoteAppDir}/.env.local`;
  const result = spawnSync(
    "sprite",
    ["exec", "-s", spriteName, "--", remoteNode, "-e", remoteWriter],
    {
      input: JSON.stringify({ path: remotePath, adminToken, ingestToken }),
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Remote secret provisioning exited ${result.status}.`);
  }

  console.log(
    `Provisioned separate Workbench admin and ingest secrets locally and on ${spriteName}.`
  );
  console.log("Values were not printed. Both .env.local files remain ignored.");
  console.log("Do not checkpoint the hosted Sprite after this operation.");
} catch (err) {
  console.error(
    `Provisioning failed: ${err instanceof Error ? err.message : String(err)}`
  );
  process.exit(1);
}
