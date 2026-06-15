const fs = require("fs/promises");
const path = require("path");
const os = require("os");

const {
  convertEditorMapToApolloPackage,
} = require("../backend/runtime/editorMapConverter");

const appRoot = path.resolve(__dirname, "..");

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function listJsonFiles(dir) {
  if (!(await pathExists(dir))) {
    return [];
  }
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      result.push(fullPath);
    }
  }
  return result;
}

async function discoverDefaultFixtures() {
  const editorMapRoot = path.join(appRoot, "data", "editor_map");
  const releaseRoot = path.join(appRoot, "data", "released_map");
  const editorMaps = (await listJsonFiles(editorMapRoot)).filter(
    (filePath) =>
      !filePath.includes(`${path.sep}.history${path.sep}`) &&
      !/\.(fixed|remote|backup|bak)\.json$/u.test(path.basename(filePath)),
  );
  const releaseEntries = (await pathExists(releaseRoot))
    ? await fs.readdir(releaseRoot, { withFileTypes: true })
    : [];
  const releasedEditorMaps = [];
  for (const entry of releaseEntries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || /\.bak(?:-|$)/u.test(entry.name)) {
      continue;
    }
    const editorMapPath = path.join(releaseRoot, entry.name, "editor_map.json");
    if (await pathExists(editorMapPath)) {
      releasedEditorMaps.push(editorMapPath);
    }
  }
  return [...editorMaps, ...releasedEditorMaps].sort();
}

function inferMapName(filePath) {
  if (path.basename(filePath) === "editor_map.json") {
    return path.basename(path.dirname(filePath));
  }
  return path.basename(filePath, ".json");
}

async function runFixture(filePath, tmpRoot) {
  const startedAt = Date.now();
  const mapName = inferMapName(filePath);
  const releaseDir = path.join(tmpRoot, mapName.replace(/[^\w.-]+/g, "_"));
  await convertEditorMapToApolloPackage({
    mapName,
    jsonPath: filePath,
    releaseDir,
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(releaseDir, "manifest.json"), "utf8"),
  );
  const summary = manifest.summary || {};
  const qualityGateIssues = Array.isArray(manifest.qualityGate?.checks)
    ? manifest.qualityGate.checks.filter((check) => check.status !== "ok")
    : [];
  return {
    mapName,
    filePath,
    summary,
    ready: summary.qualityGateReady === true,
    durationMs: Date.now() - startedAt,
    qualityGateIssues,
    warningCount: Array.isArray(manifest.warnings)
      ? manifest.warnings.length
      : 0,
    warningCodes: Array.from(
      new Set((manifest.warnings || []).map((item) => item.code)),
    ).sort(),
  };
}

async function main() {
  const args = process.argv.slice(2).filter((item) => item !== "--keep-output");
  const keepOutput = process.argv.includes("--keep-output");
  const fixtures =
    args.length > 0
      ? args.map((item) => path.resolve(item))
      : await discoverDefaultFixtures();
  if (fixtures.length === 0) {
    // data/ is gitignored, so CI checkouts have no fixtures. Skipping (exit 0) is
    // correct there: there is nothing to regress against. Locally, fixtures are
    // present and still run. The converter itself is gated on CI by the
    // self-contained contract + worker tests, which need no data/ fixtures.
    console.warn(
      "[regression] No editor map fixtures found (none on CI; data/ is gitignored). Skipping fixture regression.",
    );
    return;
  }

  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "mapeditor-regression-"),
  );
  const results = [];
  const failures = [];
  for (const [index, fixture] of fixtures.entries()) {
    console.error(`[regression] ${index + 1}/${fixtures.length} ${fixture}`);
    try {
      const result = await runFixture(fixture, tmpRoot);
      results.push(result);
      if (
        result.summary.qualityGateReady !== true ||
        Number(result.summary.qualityGateErrors || 0) > 0 ||
        Number(result.summary.contractErrors || 0) > 0
      ) {
        const issueText = result.qualityGateIssues
          .slice(0, 5)
          .map((issue) => `${issue.id || issue.title || "quality"}: ${issue.message || issue.status}`)
          .join("; ");
        failures.push({
          filePath: fixture,
          error: `quality gate not ready: ${JSON.stringify({
            qualityGateReady: result.summary.qualityGateReady,
            qualityGateErrors: result.summary.qualityGateErrors,
            contractErrors: result.summary.contractErrors,
          })}${issueText ? `; ${issueText}` : ""}`,
        });
      }
    } catch (error) {
      failures.push({
        filePath: fixture,
        error: error.message,
      });
    }
  }

  const payload = {
    tmpRoot: keepOutput ? tmpRoot : undefined,
    total: fixtures.length,
    passed: results.length,
    failed: failures.length,
    results,
    failures,
  };
  console.log(JSON.stringify(payload, null, 2));

  if (!keepOutput) {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
  if (failures.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
