#!/usr/bin/env node
'use strict';

/**
 * Static API contract gate.
 *
 * The gate compares three sources of truth:
 *
 *   1. the documented REST contract in docs/api/overview.md;
 *   2. the Express route table registered in backend/src/app.js and the module
 *      route files it mounts;
 *   3. the paths the frontend client calls in frontend/src/services/api.ts.
 *
 * It is a static check on purpose: it runs offline, needs no database, and
 * cannot be satisfied by a test that was written to mirror the implementation.
 * The gate fails when an endpoint exists without documentation, when a
 * documented endpoint is missing, or when the client calls an endpoint that
 * the contract does not describe. Every accepted difference must be recorded
 * in security/contract-gate-exceptions.json with an owner, an expiry date,
 * and a rationale; an expired entry fails the build.
 *
 * Scope note: the gate compares methods and paths. It does not verify request
 * bodies, response envelopes, status codes, or query parameters; those remain
 * covered by the runtime test suites and by documentation review.
 *
 * Usage:
 *   node scripts/check-api-contract.js [--json] [--report <path>]
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONTRACT_DOC = path.join(REPO_ROOT, 'docs', 'api', 'overview.md');
const APP_FILE = path.join(REPO_ROOT, 'backend', 'src', 'app.js');
const CLIENT_FILE = path.join(REPO_ROOT, 'frontend', 'src', 'services', 'api.ts');
const EXCEPTION_FILE = path.join(REPO_ROOT, 'security', 'contract-gate-exceptions.json');

const EXCEPTION_TYPES = new Set([
  'undocumented-implementation',
  'documented-not-implemented',
  'client-undocumented',
  'operational-endpoint',
]);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseArguments(argv) {
  const options = { json: false, report: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
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

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Required file is missing: ${path.relative(REPO_ROOT, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function normalizePath(routePath) {
  return routePath
    .replace(/\/+$/, '')
    .replace(/\/:[A-Za-z0-9_]+/g, '/:param')
    .replace(/\/{2,}/g, '/');
}

function endpointKey(method, routePath) {
  return `${method.toUpperCase()} ${normalizePath(routePath)}`;
}

/**
 * Extracts the documented endpoints from the API contract markdown.
 */
function parseDocumentedEndpoints(markdown) {
  const basePathMatch = markdown.match(/\|\s*Base path\s*\|\s*`([^`]+)`\s*\|/);
  if (!basePathMatch) {
    throw new Error('docs/api/overview.md does not declare a "Base path" row.');
  }
  const basePath = basePathMatch[1].replace(/\/+$/, '');

  const endpoints = new Map();
  const add = (method, routePath, source) => {
    const fullPath = `${basePath}${routePath}`.replace(/\/+$/, '') || basePath;
    const key = endpointKey(method, fullPath);
    if (!endpoints.has(key)) {
      endpoints.set(key, { method: method.toUpperCase(), path: fullPath, source });
    }
  };

  const tableRow = /^\|\s*`(GET|POST|PUT|DELETE|PATCH)`\s*\|\s*`(\/[^`]*)`\s*\|/gm;
  let match = tableRow.exec(markdown);
  while (match) {
    add(match[1], match[2], 'docs/api/overview.md table');
    match = tableRow.exec(markdown);
  }

  const heading = /^#{2,4}[^\n]*`(GET|POST|PUT|DELETE|PATCH)\s+(\/[^`]*)`/gm;
  match = heading.exec(markdown);
  while (match) {
    add(match[1], match[2], 'docs/api/overview.md heading');
    match = heading.exec(markdown);
  }

  return { basePath, endpoints };
}

/**
 * Extracts the Express route table from the application entry point and the
 * mounted module route files.
 */
function parseImplementedEndpoints(appSource, rootDirectory = REPO_ROOT) {
  const endpoints = new Map();
  const operational = new Map();

  const requires = new Map();
  const requirePattern = /const\s+(\w+)\s*=\s*require\(['"](\.\/modules\/[^'"]+)['"]\)/g;
  let match = requirePattern.exec(appSource);
  while (match) {
    requires.set(match[1], match[2]);
    match = requirePattern.exec(appSource);
  }

  const mountPattern = /app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g;
  const mounts = [];
  match = mountPattern.exec(appSource);
  while (match) {
    const modulePath = requires.get(match[2]);
    if (modulePath) {
      mounts.push({ prefix: match[1], modulePath });
    }
    match = mountPattern.exec(appSource);
  }

  const directPattern = /app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g;
  match = directPattern.exec(appSource);
  while (match) {
    const key = endpointKey(match[1], match[2]);
    operational.set(key, { method: match[1].toUpperCase(), path: match[2], source: 'backend/src/app.js' });
    match = directPattern.exec(appSource);
  }

  for (const mount of mounts) {
    const moduleFile = path.join(rootDirectory, 'backend', 'src', `${mount.modulePath}.js`);
    const source = readText(moduleFile);
    const relativeSource = path.relative(rootDirectory, moduleFile);

    const statements = [];
    const statementPattern = /router\.(get|post|put|delete|patch)\(\s*(['"`])([^'"`]+)\2/g;
    let statementMatch = statementPattern.exec(source);
    while (statementMatch) {
      statements.push({
        method: statementMatch[1],
        routePath: statementMatch[3],
        index: statementMatch.index,
      });
      statementMatch = statementPattern.exec(source);
    }

    for (const statement of statements) {
      const window = source.slice(statement.index, statement.index + 400);
      if (window.includes('METHOD_NOT_ALLOWED')) {
        // The route exists only to return the documented 405 response for an
        // unsupported method. It is not an API endpoint.
        continue;
      }
      const fullPath = `${mount.prefix}${statement.routePath}`.replace(/\/+$/, '');
      const key = endpointKey(statement.method, fullPath);
      endpoints.set(key, {
        method: statement.method.toUpperCase(),
        path: fullPath,
        source: relativeSource,
      });
    }
  }

  return { endpoints, operational };
}

/**
 * Extracts the API paths the frontend client calls.
 *
 * The client prefixes every call with a base path constant and passes the
 * HTTP method inside the options object, so both are read from the source.
 */
function parseClientEndpoints(clientSource) {
  const endpoints = new Map();

  const baseUrlMatch = clientSource.match(/const\s+BASE_URL\s*=\s*'([^']+)'/);
  if (!baseUrlMatch) {
    throw new Error('frontend/src/services/api.ts does not declare a BASE_URL constant.');
  }
  const basePath = baseUrlMatch[1].replace(/\/+$/, '');

  const callPattern = /\b(?:request|requestBlob)(?:<[^>]*>)?\(\s*(['"`])(\/[^'"`]*)\1/g;
  let match = callPattern.exec(clientSource);
  while (match) {
    const rawPath = match[2];
    const callBody = readCallBody(clientSource, match.index);
    const methodMatch = callBody.match(/\bmethod\s*:\s*['"]([A-Za-z]+)['"]/);
    const method = methodMatch ? methodMatch[1].toUpperCase() : 'GET';

    const normalized = rawPath
      .replace(/\$\{\s*query\s*\}/g, '')
      .replace(/\$\{[^}]*\}/g, ':param')
      .replace(/\?.*$/, '')
      .replace(/\/+$/, '');
    const fullPath = `${basePath}${normalized}`.replace(/\/+$/, '');
    const key = endpointKey(method, fullPath);
    if (!endpoints.has(key)) {
      endpoints.set(key, { method, path: fullPath, source: 'frontend/src/services/api.ts' });
    }
    match = callPattern.exec(clientSource);
  }
  return endpoints;
}

/**
 * Returns the source text of a call expression, from the opening parenthesis
 * to its matching closing parenthesis.
 */
function readCallBody(source, callIndex) {
  const openIndex = source.indexOf('(', callIndex);
  if (openIndex === -1) {
    return '';
  }

  let depth = 0;
  let quote = '';
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openIndex, index + 1);
      }
    }
  }
  return source.slice(openIndex);
}

function parseExceptions(exceptionSource) {
  const problems = [];
  const exceptions = new Map();
  const registry = JSON.parse(exceptionSource);

  if (!Array.isArray(registry.exceptions)) {
    problems.push('security/contract-gate-exceptions.json.exceptions must be an array.');
    return { exceptions, problems };
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const entry of registry.exceptions) {
    if (!entry || typeof entry !== 'object') {
      problems.push('Each contract exception must be an object.');
      continue;
    }
    if (!EXCEPTION_TYPES.has(entry.type)) {
      problems.push(`Contract exception ${entry.id} has an unsupported type: ${entry.type}`);
    }
    if (typeof entry.owner !== 'string' || entry.owner.trim().length < 2) {
      problems.push(`Contract exception ${entry.id} must name an owner.`);
    }
    if (typeof entry.rationale !== 'string' || entry.rationale.trim().length < 10) {
      problems.push(`Contract exception ${entry.id} must state a rationale.`);
    }
    if (typeof entry.expiresAt !== 'string' || !ISO_DATE_PATTERN.test(entry.expiresAt)) {
      problems.push(`Contract exception ${entry.id} must set expiresAt as YYYY-MM-DD.`);
    } else if (entry.expiresAt < today) {
      problems.push(`Contract exception ${entry.id} expired on ${entry.expiresAt}.`);
    }
    if (typeof entry.method === 'string' && typeof entry.path === 'string') {
      exceptions.set(endpointKey(entry.method, entry.path), entry);
    }
  }

  return { exceptions, problems };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/check-api-contract.js [--json] [--report <path>]\n');
    return 0;
  }

  const report = {
    ok: true,
    basePath: '',
    documented: [],
    implemented: [],
    clientCalled: [],
    operational: [],
    differences: [],
    problems: [],
  };

  try {
    const contract = parseDocumentedEndpoints(readText(CONTRACT_DOC));
    report.basePath = contract.basePath;

    const implementation = parseImplementedEndpoints(readText(APP_FILE));
    const client = parseClientEndpoints(readText(CLIENT_FILE));
    const { exceptions, problems } = parseExceptions(readText(EXCEPTION_FILE));
    report.problems.push(...problems);

    report.documented = [...contract.endpoints.values()];
    report.implemented = [...implementation.endpoints.values()];
    report.clientCalled = [...client.values()];
    report.operational = [...implementation.operational.values()];

    const isExcepted = (method, routePath, allowedTypes) => {
      const entry = exceptions.get(endpointKey(method, routePath));
      if (!entry) {
        return false;
      }
      if (!allowedTypes.includes(entry.type)) {
        report.problems.push(
          `Contract exception ${entry.id} has type ${entry.type}, which does not cover this difference.`
        );
        return false;
      }
      return true;
    };

    for (const [key, endpoint] of contract.endpoints) {
      if (!implementation.endpoints.has(key)) {
        if (!isExcepted(endpoint.method, endpoint.path, ['documented-not-implemented'])) {
          report.differences.push({
            kind: 'documented-not-implemented',
            method: endpoint.method,
            path: endpoint.path,
            detail: 'docs/api/overview.md documents this endpoint but no Express route registers it.',
          });
        }
      }
    }

    for (const [key, endpoint] of implementation.endpoints) {
      if (!contract.endpoints.has(key)) {
        if (!isExcepted(endpoint.method, endpoint.path, ['undocumented-implementation'])) {
          report.differences.push({
            kind: 'undocumented-implementation',
            method: endpoint.method,
            path: endpoint.path,
            detail: `${endpoint.source} registers this endpoint but docs/api/overview.md does not document it.`,
          });
        }
      }
    }

    for (const [key, endpoint] of client) {
      if (!contract.endpoints.has(key)) {
        if (!isExcepted(endpoint.method, endpoint.path, ['undocumented-implementation', 'client-undocumented'])) {
          report.differences.push({
            kind: 'client-undocumented',
            method: endpoint.method,
            path: endpoint.path,
            detail: `${endpoint.source} calls this endpoint but docs/api/overview.md does not document it.`,
          });
        }
      }
    }

    for (const [, endpoint] of implementation.operational) {
      if (!isExcepted(endpoint.method, endpoint.path, ['operational-endpoint'])) {
        report.differences.push({
          kind: 'operational-endpoint',
          method: endpoint.method,
          path: endpoint.path,
          detail: `${endpoint.source} registers an operational endpoint outside ${contract.basePath}; register it as an approved operational endpoint.`,
        });
      }
    }
  } catch (error) {
    report.ok = false;
    report.problems.push(error.message);
  }

  if (report.differences.length > 0 || report.problems.length > 0) {
    report.ok = false;
  }

  if (options.report) {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Contract gate: ${report.documented.length} documented, ${report.implemented.length} implemented, ` +
        `${report.clientCalled.length} client-called, ${report.operational.length} operational endpoint(s).\n`
    );
    for (const problem of report.problems) {
      process.stderr.write(`Contract gate error: ${problem}\n`);
    }
    for (const difference of report.differences) {
      process.stderr.write(
        `Contract gate error: [${difference.kind}] ${difference.method} ${difference.path} - ${difference.detail}\n`
      );
    }
    process.stdout.write(
      report.ok
        ? 'Static API contract gate passed.\n'
        : 'Static API contract gate failed.\n'
    );
  }

  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  endpointKey,
  normalizePath,
  parseClientEndpoints,
  parseDocumentedEndpoints,
  parseExceptions,
  parseImplementedEndpoints,
};
