#!/usr/bin/env node
'use strict';

/**
 * Builds a Trivy ignore file from the approved vulnerability exception
 * registry.
 *
 * The registry is validated first, so an expired or malformed exception can
 * never reach the scanner. Trivy ignores an advisory identifier globally, so
 * every exception is required to name the affected package and the statement
 * records that scope for the release evidence.
 *
 * Usage:
 *   node scripts/build-trivy-ignorefile.js [--file <registry>] [--out <path>]
 */

const fs = require('fs');
const path = require('path');

const {
  readJsonFile,
  validateVulnerabilityRegistry,
} = require('./check-security-exceptions');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_REGISTRY = path.join(REPO_ROOT, 'security', 'vulnerability-exceptions.json');

function parseArguments(argv) {
  const options = { file: DEFAULT_REGISTRY, out: '' };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--file') {
      index += 1;
      options.file = path.resolve(argv[index] || '');
    } else if (argument === '--out') {
      index += 1;
      options.out = path.resolve(argv[index] || '');
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function buildIgnoreEntries(registry) {
  return (registry.exceptions || []).map((entry) => ({
    vulnerabilityID: entry.advisory,
    statement:
      `Approved exception ${entry.id} for ${entry.package}; owner=${entry.owner}; ` +
      `riskTreatment=${entry.riskTreatment}; expiresAt=${entry.expiresAt}`,
    paths: [],
  }));
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/build-trivy-ignorefile.js [--file <registry>] [--out <path>]\n');
    return 0;
  }

  const registry = readJsonFile(options.file);
  const result = validateVulnerabilityRegistry(registry, options.file);
  if (result.problems.length > 0) {
    for (const problem of result.problems) {
      process.stderr.write(`Vulnerability exception registry error: ${problem}\n`);
    }
    return 1;
  }

  const entries = buildIgnoreEntries(registry);
  const serialized = `${JSON.stringify(entries, null, 2)}\n`;

  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, serialized, 'utf8');
    process.stdout.write(`Trivy ignore file written: ${path.relative(REPO_ROOT, options.out)} (${entries.length} entr(y|ies))\n`);
  } else {
    process.stdout.write(serialized);
  }

  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { buildIgnoreEntries, parseArguments };
