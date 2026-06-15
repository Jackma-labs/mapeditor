// Regression test for the worker_thread converter path (Round 3 perf change).
// The runtime publish flow runs the JS Apollo converter in a worker so a large
// publish does not block the event loop. This test asserts the worker entry runs
// a real fixture end-to-end and returns the same success contract as the direct
// in-process call, so the off-thread path cannot silently break in production.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { Worker } = require("worker_threads");

const {
  convertEditorMapToApolloPackage,
} = require("../backend/runtime/editorMapConverter");

const appRoot = path.resolve(__dirname, "..");
const WORKER_PATH = path.join(
  appRoot,
  "backend",
  "runtime",
  "editorMapConverterWorker.js",
);

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function findFixture() {
  const candidates = [
    path.join(appRoot, "data", "editor_map", "yuanqu_1_apollo_complete.json"),
    path.join(appRoot, "data", "editor_map", "2026-5-25-3.fixed.json"),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  // Fall back to the first editor_map json on disk.
  const dir = path.join(appRoot, "data", "editor_map");
  if (await pathExists(dir)) {
    const entries = (await fsp.readdir(dir)).filter((name) =>
      name.endsWith(".json"),
    );
    if (entries.length > 0) {
      return path.join(dir, entries[0]);
    }
  }
  return null;
}

function runInWorker(options) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: options });
    let settled = false;
    worker.on("message", (message) => {
      settled = true;
      worker.terminate().catch(() => {});
      resolve(message);
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        reject(new Error(`worker exited with code ${code}`));
      }
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  const jsonPath = await findFixture();
  if (!jsonPath) {
    console.log("[skip] no editor_map fixture available; nothing to test");
    return;
  }

  const releaseDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "converter-worker-test-"),
  );
  try {
    const message = await runInWorker({
      mapName: "worker_contract",
      jsonPath,
      releaseDir,
      baseMapDir: null,
    });

    assert(message && message.ok === true, "worker reported success");
    assert(message.result && message.result.code === 0, "converter exit code 0");

    const requiredFiles = [
      "base_map.bin",
      "base_map.txt",
      "routing_map.bin",
      "sim_map.bin",
      "manifest.json",
    ];
    for (const file of requiredFiles) {
      assert(
        await pathExists(path.join(releaseDir, file)),
        `release artifact present: ${file}`,
      );
    }

    console.log(
      JSON.stringify({
        fixture: path.basename(jsonPath),
        workerOk: message.ok,
        code: message.result.code,
        artifacts: fs.readdirSync(releaseDir).length,
      }),
    );
    console.log("[pass] converter worker contract");
  } finally {
    await fsp.rm(releaseDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("[fail]", error.message);
  process.exit(1);
});
