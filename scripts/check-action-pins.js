#!/usr/bin/env node
'use strict';

/**
 * Verifies that every GitHub Action used by a workflow is pinned to an exact
 * commit SHA that is recorded in the approved pin registry.
 *
 * The registry (security/action-pins.json) is the reviewed record of the
 * upstream commit that each pinned version refers to. A workflow that pins a
 * SHA which is not in the registry fails, and a workflow that pins a
 * different SHA than the registry records fails. This is what catches a
 * mistyped or non-existent commit: the registry is only updated after the
 * commit was resolved with `git ls-remote` and confirmed with the GitHub
 * commits API.
 *
 * Usage:
 *   node scripts/check-action-pins.js
 *   node scripts/check-action-pins.js --verify-remote   # also query GitHub
 *   node scripts/check-action-pins.js --verify-remote --allow-unavailable
 *   node scripts/check-action-pins.js --report <path>
 *
 * `--allow-unavailable` downgrades an unreachable or rate-limited upstream
 * API to a warning. A commit that the upstream API does not resolve is
 * always an error, whether or not the flag is set.
 *
 * Environment:
 *   GITHUB_TOKEN   optional; raises the GitHub API rate limit for the
 *                  remote verification
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOW_DIRECTORY = path.join(REPO_ROOT, '.github', 'workflows');
const REGISTRY_FILE = path.join(REPO_ROOT, 'security', 'action-pins.json');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const USES_PATTERN = /^\s*(?:-\s+)?uses:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/gm;

function parseArguments(argv) {
  const options = { verifyRemote: false, allowUnavailable: false, report: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--verify-remote') {
      options.verifyRemote = true;
    } else if (argument === '--allow-unavailable') {
      options.allowUnavailable = true;
    } else if (argument === '--report') {
      index += 1;
      options.report = path.resolve(argv[index] || '');
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

/**
 * Extracts every `uses:` reference from a workflow source.
 *
 * Local actions (`./path`) and Docker image references are ignored: they are
 * not upstream GitHub repositories.
 */
function extractUses(source) {
  const references = [];
  const pattern = new RegExp(USES_PATTERN.source, 'gm');
  let match = pattern.exec(source);
  while (match) {
    const value = match[1];
    if (value.startsWith('./') || value.startsWith('docker://')) {
      match = pattern.exec(source);
      continue;
    }
    references.push(value);
    match = pattern.exec(source);
  }
  return references;
}

function readRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) {
    throw new Error(`The action pin registry is missing: ${path.relative(REPO_ROOT, REGISTRY_FILE)}`);
  }
  const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  if (!Array.isArray(parsed.actions)) {
    throw new Error('The action pin registry must define an actions array.');
  }
  const registry = new Map();
  for (const entry of parsed.actions) {
    if (!entry || typeof entry.action !== 'string' || typeof entry.sha !== 'string') {
      throw new Error('Every registry entry must define an action and a sha.');
    }
    if (!SHA_PATTERN.test(entry.sha)) {
      throw new Error(
        `The registry entry for '${entry.action}' does not record an exact 40 character commit SHA.`
      );
    }
    if (registry.has(entry.action)) {
      throw new Error(`The registry records '${entry.action}' more than once.`);
    }
    registry.set(entry.action, entry);
  }
  return registry;
}

async function verifyRemoteCommit(action, sha) {
  const [owner, repository] = action.split('/');
  const headers = {
    accept: 'application/vnd.github+json',
    'user-agent': 'sigap-action-pin-check',
    'x-github-api-version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/commits/${sha}`, {
    headers,
  });

  if (response.status === 404 || response.status === 422) {
    return { status: 'missing', detail: `HTTP ${response.status} ${response.statusText}` };
  }
  if (response.status === 403 || response.status === 429) {
    // The upstream repository exists but the API refused the request, most
    // often because of an API rate limit. This is "not verified", not
    // "not a commit".
    return { status: 'unavailable', detail: `HTTP ${response.status} ${response.statusText}` };
  }
  if (!response.ok) {
    return { status: 'unavailable', detail: `HTTP ${response.status} ${response.statusText}` };
  }

  const payload = await response.json();
  if (payload.sha !== sha) {
    return { status: 'missing', detail: `the API returned '${payload.sha}'` };
  }
  return { status: 'ok', detail: payload.sha };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/check-action-pins.js [--verify-remote] [--allow-unavailable] [--report <path>]\n'
    );
    return 0;
  }

  const problems = [];
  const report = { ok: true, checked: 0, actions: [], problems: [], warnings: [] };

  let registry;
  try {
    registry = readRegistry();
  } catch (error) {
    process.stderr.write(`Action pin gate error: ${error.message}\n`);
    return 1;
  }

  if (!fs.existsSync(WORKFLOW_DIRECTORY)) {
    process.stderr.write('Action pin gate error: the .github/workflows directory is missing.\n');
    return 1;
  }

  const workflowFiles = fs
    .readdirSync(WORKFLOW_DIRECTORY)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort();

  for (const fileName of workflowFiles) {
    const filePath = path.join(WORKFLOW_DIRECTORY, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(REPO_ROOT, filePath);

    for (const reference of extractUses(source)) {
      report.checked += 1;
      const separator = reference.lastIndexOf('@');
      if (separator === -1) {
        problems.push(`${relativePath}: '${reference}' is not pinned to a commit SHA.`);
        continue;
      }
      const action = reference.slice(0, separator);
      const ref = reference.slice(separator + 1);

      if (!SHA_PATTERN.test(ref)) {
        problems.push(
          `${relativePath}: '${action}' is pinned to '${ref}', which is not an exact 40 character commit SHA.`
        );
        continue;
      }

      const entry = registry.get(action);
      if (!entry) {
        problems.push(
          `${relativePath}: '${action}' is not recorded in security/action-pins.json. Verify the upstream commit and add it to the registry.`
        );
        continue;
      }

      if (entry.sha !== ref) {
        problems.push(
          `${relativePath}: '${action}' is pinned to '${ref}' but security/action-pins.json records '${entry.sha}' for ${entry.version}.`
        );
        continue;
      }

      report.actions.push({ workflow: relativePath, action, ref, version: entry.version });
    }
  }

  if (options.verifyRemote) {
    const unique = new Map();
    for (const item of report.actions) {
      unique.set(item.action, item.ref);
    }
    for (const [action, sha] of unique) {
      try {
        const verification = await verifyRemoteCommit(action, sha);
        if (verification.status === 'missing') {
          problems.push(
            `The upstream repository does not resolve '${action}' at commit '${sha}' (${verification.detail}). The pin is wrong.`
          );
        } else if (verification.status === 'unavailable') {
          if (options.allowUnavailable) {
            report.warnings.push(
              `The upstream verification for '${action}' could not be performed (${verification.detail}); the pin was not re-checked.`
            );
          } else {
            problems.push(
              `The upstream verification for '${action}' could not be performed (${verification.detail}).`
            );
          }
        }
      } catch (error) {
        if (options.allowUnavailable) {
          report.warnings.push(
            `The upstream verification for '${action}' failed: ${error.message}; the pin was not re-checked.`
          );
        } else {
          problems.push(`The upstream verification for '${action}' failed: ${error.message}`);
        }
      }
    }
  }

  report.problems = problems;
  report.ok = problems.length === 0;

  if (options.report) {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  for (const warning of report.warnings) {
    process.stderr.write(`Action pin gate warning: ${warning}\n`);
  }

  if (!report.ok) {
    for (const problem of problems) {
      process.stderr.write(`Action pin gate error: ${problem}\n`);
    }
    process.stderr.write('Action pin gate failed.\n');
    return 1;
  }

  const uniqueCount = new Set(report.actions.map((item) => item.action)).size;
  process.stdout.write(
    `Action pin gate passed: ${report.checked} action use(s) across ${workflowFiles.length} workflow file(s), ` +
      `${uniqueCount} distinct action(s), all pinned to a registered commit SHA.\n`
  );
  return 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`Action pin gate error: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = { extractUses, parseArguments, readRegistry };
