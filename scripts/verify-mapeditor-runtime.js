#!/usr/bin/env node

const baseUrl = (process.env.MAPEDITOR_VERIFY_URL || process.argv[2] || 'http://127.0.0.1:58000').replace(/\/+$/u, '');

async function readJson(pathname, options = {}) {
  const url = `${baseUrl}${pathname}`;
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({
    code: response.status,
    message: response.statusText,
  }));
  return {
    url,
    status: response.status,
    ok: response.ok,
    payload,
  };
}

function formatChecks(checks = []) {
  if (!checks.length) {
    return 'no checks';
  }
  return checks.map((check) => `${check.name || 'check'}=${check.status || 'unknown'}`).join(', ');
}

function getActiveRoutingFailure(data) {
  const routingFailure = data.routingDiagnostics?.latestFailure || data.diagnosis?.routingDiagnostics?.latestFailure;
  const currentMapState = data.currentMapState || data.diagnosis?.currentMapState;
  if (!routingFailure) {
    return null;
  }
  const resetTime = Date.parse(currentMapState?.lastSimulationResetAt || '');
  const failureTime = Date.parse(routingFailure.timestamp || '');
  if (Number.isFinite(resetTime) && Number.isFinite(failureTime) && failureTime <= resetTime) {
    return null;
  }
  return routingFailure;
}

async function main() {
  const results = [];
  results.push(await readJson('/healthz'));
  results.push(await readJson('/runtime/doctor'));
  results.push(await readJson('/runtime/apollolite/diagnose'));
  results.push(await readJson('/runtime/apollolite/workflow'));

  let failed = false;
  for (const result of results) {
    const payload = result.payload || {};
    const data = payload.data || payload;
    const checks = data.checks || data.diagnosis?.checks || [];
    const ready = data.ready;
    const payloadCodeOk = payload.code === 0 || (payload.code === undefined && result.ok);
    const status = result.ok && payloadCodeOk ? 'ok' : 'warn';
    if (status !== 'ok') {
      failed = true;
    }
    console.log(`${status} ${result.url} http=${result.status} code=${payload.code} ready=${ready}`);
    console.log(`  ${payload.message || 'Success'}; ${formatChecks(checks)}`);
    if (data.nextAction) {
      console.log(`  next: ${data.nextAction}`);
    }
    const routingFailure = getActiveRoutingFailure(data);
    if (routingFailure) {
      console.log(`  routing: ${routingFailure.message}`);
      console.log(`  advice: ${routingFailure.suggestion}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
