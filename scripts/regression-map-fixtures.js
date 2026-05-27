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
    (filePath) => !filePath.includes(`${path.sep}.history${path.sep}`),
  );
  const releasedEditorMaps = (await listJsonFiles(releaseRoot)).filter(
    (filePath) => path.basename(filePath) === "editor_map.json",
  );
  return [...editorMaps, ...releasedEditorMaps].sort();
}

function inferMapName(filePath) {
  if (path.basename(filePath) === "editor_map.json") {
    return path.basename(path.dirname(filePath));
  }
  return path.basename(filePath, ".json");
}

async function runFixture(filePath, tmpRoot) {
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
  return {
    mapName,
    filePath,
    summary: manifest.summary || {},
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
    throw new Error(
      "No editor map fixtures found. Pass JSON paths explicitly or add data/editor_map/*.json.",
    );
  }

  const tmpRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "mapeditor-regression-"),
  );
  const results = [];
  const failures = [];
  for (const fixture of fixtures) {
    try {
      results.push(await runFixture(fixture, tmpRoot));
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
