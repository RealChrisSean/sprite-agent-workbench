#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolveSpriteName } from "./workbench-core.mjs";

const spriteName = resolveSpriteName();
const appDir = process.env.WORKBENCH_REMOTE_APP_DIR || "/home/sprite/app";
const serviceName =
  process.env.WORKBENCH_SERVICE_NAME || "sprite-agent-workbench";

if (!spriteName) {
  console.error(
    "Error: could not resolve a Sprite. Set SPRITE_NAME or add a .sprite file."
  );
  process.exit(2);
}

function remote(command, args = [], { capture = false, allowFailure = false } = {}) {
  const result = spawnSync(
    "sprite",
    ["exec", "-s", spriteName, "--", command, ...args],
    {
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
    }
  );
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `Remote command failed (${command}, exit ${result.status ?? "unknown"}).`
    );
  }
  return result;
}

try {
  console.log(`Deploying main to ${spriteName}:${appDir}`);
  remote("/usr/bin/git", ["-C", appDir, "pull", "--ff-only", "origin", "main"]);

  const npmResult = remote("/usr/bin/which", ["npm"], { capture: true });
  const npmPath = npmResult.stdout.trim();
  if (!npmPath.startsWith("/")) throw new Error("Remote npm path was not absolute.");

  remote(npmPath, ["--prefix", appDir, "ci"]);
  remote(npmPath, ["--prefix", appDir, "run", "build"]);

  const service = remote("sprite-env", ["services", "get", serviceName], {
    capture: true,
    allowFailure: true,
  });
  if (service.status === 0) {
    remote("sprite-env", ["services", "restart", serviceName]);
  } else {
    console.log(`Installing Service ${serviceName} on HTTP port 8080.`);
    remote("sprite-env", [
      "services",
      "create",
      serviceName,
      "--cmd",
      npmPath,
      "--args",
      "start",
      "--dir",
      appDir,
      "--http-port",
      "8080",
      "--duration",
      "10s",
    ]);
  }

  remote("/usr/bin/curl", [
    "--fail",
    "--silent",
    "--show-error",
    "--retry",
    "8",
    "--retry-connrefused",
    "--retry-delay",
    "1",
    "http://127.0.0.1:8080/",
    "--output",
    "/dev/null",
  ]);
  console.log(`Deploy complete: ${serviceName} is responding on port 8080.`);
  console.log("No checkpoint was created; hosted secret files were not snapshotted.");
} catch (err) {
  console.error(`Deploy failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
