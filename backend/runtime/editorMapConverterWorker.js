// Worker entry that runs the (CPU-heavy, synchronous-core) JS Apollo map
// converter off the main event loop. Keeping it in a worker_thread stops a large
// map publish from freezing all HTTP/WebSocket traffic for the duration of the
// conversion. The converter reads from jsonPath and writes to releaseDir itself,
// and returns a small JSON-cloneable result, so it maps cleanly onto a worker.
const { parentPort, workerData } = require('worker_threads');
const { convertEditorMapToApolloPackage } = require('./editorMapConverter');

(async () => {
  try {
    const result = await convertEditorMapToApolloPackage(workerData);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error: { message: error && error.message ? error.message : String(error) },
    });
  }
})();
