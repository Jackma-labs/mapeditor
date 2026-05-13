const { spawn } = require('child_process');

function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 0;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      ...options.spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;
    let timeoutId = null;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        killedByTimeout = true;
        child.kill('SIGKILL');
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });
    child.on('close', (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      const result = { code, stdout, stderr, command, args };
      if (code === 0) {
        resolve(result);
        return;
      }
      const reason = killedByTimeout
        ? `command timed out after ${timeoutMs} ms`
        : `command exited with code ${code}`;
      const error = new Error(`${reason}: ${command} ${args.join(' ')}\n${stderr || stdout}`);
      error.result = result;
      reject(error);
    });
  });
}

module.exports = { runCommand };
