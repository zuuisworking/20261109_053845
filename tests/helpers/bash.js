const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

let cachedBash;

/**
 * Locates a usable bash executable.
 *
 * The Windows `bash.exe` that ships with WSL is not a usable POSIX shell when
 * no distribution is installed, so every candidate is executed once and only
 * a shell that actually starts is accepted.
 */
function findBash() {
  if (cachedBash !== undefined) {
    return cachedBash;
  }

  const candidates = [];
  if (process.env.BASH_PATH) {
    candidates.push(process.env.BASH_PATH);
  }
  candidates.push('/bin/bash', 'bash');
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe'
    );
  }

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 20000 });
    if (!result.error && result.status === 0) {
      cachedBash = candidate;
      return cachedBash;
    }
  }

  cachedBash = null;
  return cachedBash;
}

/**
 * Runs a shell script from the repository and returns the captured result.
 */
function runScript(scriptRelativePath, args = [], env = {}) {
  const bash = findBash();
  if (!bash) {
    throw new Error('No usable bash executable was found on this machine.');
  }

  const scriptPath = path.join(REPO_ROOT, scriptRelativePath);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptRelativePath}`);
  }

  const result = spawnSync(bash, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...process.env,
      ...env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    output: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/**
 * Creates an isolated temporary directory for a test case.
 */
function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = { REPO_ROOT, findBash, runScript, makeTempDir };
