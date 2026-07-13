#!/usr/bin/env node

try {
  process.loadEnvFile?.(".env.local");
} catch (err) {
  if (!err || typeof err !== "object" || err.code !== "ENOENT") throw err;
}

const workbenchUrl = process.env.WORKBENCH_URL || "http://localhost:1340";
const ingestToken = process.env.WORKBENCH_INGEST_TOKEN?.trim();
const edgeToken = process.env.WORKBENCH_EDGE_TOKEN?.trim();

if (!ingestToken) {
  console.error("Error: WORKBENCH_INGEST_TOKEN is required.");
  process.exit(2);
}

try {
  const url = new URL("/api/observe", workbenchUrl);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workbench-ingest-token": ingestToken,
      ...(edgeToken ? { authorization: `Bearer ${edgeToken}` } : {}),
    },
    body: "{}",
    redirect: "manual",
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Unexpected redirect (${response.status}).`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error("Workbench returned a non-JSON response.");
  }
  const body = await response.json();
  if (!response.ok || body.ok !== true) {
    throw new Error(body.message || `Workbench returned HTTP ${response.status}.`);
  }
  const result = body.result;
  console.log(
    `Collected ${result.spriteCount} Sprites; recorded ${result.checkpointEventsRecorded} new checkpoint events at ${result.observedAt}.`
  );
  if (result.warnings?.length) {
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  }
} catch (err) {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
