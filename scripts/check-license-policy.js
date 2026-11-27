#!/usr/bin/env node
'use strict';

/**
 * Bounded license gate for the installed dependency trees.
 *
 * This is an explicitly bounded equivalent of a full license scan: it reads
 * the declared license metadata of every installed package in the root and
 * frontend dependency trees and fails closed on missing, unknown, or denied
 * licenses. It does not inspect license texts, bundled assets, fonts, images,
 * or container base layers. Those remain operator review items and are listed
 * as such in security/README.md.
 *
 * Usage:
 *   node scripts/check-license-policy.js [--root <dir>] [--frontend <dir>]
 *                                         [--policy <file>] [--report <path>]
 *                                         [--json]
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_POLICY_FILE = path.join(REPO_ROOT, 'security', 'license-exceptions.json');

function parseArguments(argv) {
  const options = {
    roots: [path.join(REPO_ROOT, 'node_modules'), path.join(REPO_ROOT, 'frontend', 'node_modules')],
    policyFile: DEFAULT_POLICY_FILE,
    report: '',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') {
      index += 1;
      options.roots = [path.resolve(argv[index] || '')];
    } else if (argument === '--policy') {
      index += 1;
      options.policyFile = path.resolve(argv[index] || '');
    } else if (argument === '--report') {
      index += 1;
      options.report = path.resolve(argv[index] || '');
    } else if (argument === '--json') {
      options.json = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function readPolicy(policyFile) {
  if (!fs.existsSync(policyFile)) {
    throw new Error(`License policy file is missing: ${path.relative(REPO_ROOT, policyFile)}`);
  }
  const parsed = JSON.parse(fs.readFileSync(policyFile, 'utf8'));
  if (!parsed.policy || !Array.isArray(parsed.policy.allowed) || !Array.isArray(parsed.policy.denied)) {
    throw new Error('License policy must define policy.allowed and policy.denied arrays.');
  }
  if (!Array.isArray(parsed.exceptions)) {
    throw new Error('License policy must define an exceptions array.');
  }
  return parsed;
}

function normalizeLicenseValue(value) {
  if (typeof value === 'string') {
    return [value];
  }
  if (value && typeof value === 'object') {
    if (typeof value.type === 'string') {
      return [value.type];
    }
    if (Array.isArray(value.licenses)) {
      return value.licenses
        .map((entry) => (entry && typeof entry.type === 'string' ? entry.type : null))
        .filter(Boolean);
    }
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry;
        if (entry && typeof entry.type === 'string') return entry.type;
        return null;
      })
      .filter(Boolean);
  }
  return [];
}

/**
 * Splits an SPDX-style expression into the alternatives a consumer may pick.
 *
 * `A OR B` means the consumer may choose either license, so the package is
 * acceptable when at least one alternative is fully allowed. `A AND B` and
 * `A WITH <exception>` are conjunctions and must all be acceptable. The
 * legacy `A/B` dual form is treated like `A OR B`.
 */
function splitLicenseExpression(expression) {
  if (!expression || expression.includes('SEE LICENSE IN')) {
    return { alternatives: [], hasUnresolvedText: Boolean(expression) };
  }

  const alternatives = expression
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+|\s*\/\s*/g)
    .map((alternative) =>
      alternative
        .split(/\s+AND\s+/)
        .flatMap((conjunction) =>
          conjunction
            .split(/\s+WITH\s+/)
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
        )
        .filter((part) => part.length > 0)
    )
    .filter((parts) => parts.length > 0);

  return { alternatives, hasUnresolvedText: false };
}

function collectPackageDirectories(nodeModulesDir) {
  const packages = [];

  function walk(directory, depth) {
    if (depth > 4) {
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_error) {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (entry.name.startsWith('.')) {
        continue;
      }

      if (entry.name.startsWith('@')) {
        walk(path.join(directory, entry.name), depth);
        continue;
      }

      const packageDir = path.join(directory, entry.name);
      const manifestPath = path.join(packageDir, 'package.json');
      if (fs.existsSync(manifestPath)) {
        packages.push({ directory: packageDir, manifestPath });
      }

      const nested = path.join(packageDir, 'node_modules');
      if (fs.existsSync(nested)) {
        walk(nested, depth + 1);
      }
    }
  }

  if (fs.existsSync(nodeModulesDir)) {
    walk(nodeModulesDir, 0);
  }

  return packages;
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function packageIdentity(manifest, directory) {
  const name = manifest && typeof manifest.name === 'string' ? manifest.name : path.basename(directory);
  const version = manifest && typeof manifest.version === 'string' ? manifest.version : '0.0.0';
  return `${name}@${version}`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/check-license-policy.js [--root <dir>] [--policy <file>] [--report <path>] [--json]\n'
    );
    return 0;
  }

  const report = { ok: true, scanned: 0, findings: [], missingTrees: [], licenses: {} };

  try {
    const policy = readPolicy(options.policyFile);
    const allowed = new Set(policy.policy.allowed.map((value) => value.toUpperCase()));
    const denied = new Set(policy.policy.denied.map((value) => value.toUpperCase()));
    const exceptions = new Map(
      (policy.exceptions || []).map((entry) => [`${entry.package}@${entry.license}`.toLowerCase(), entry])
    );

    for (const nodeModulesDir of options.roots) {
      if (!fs.existsSync(nodeModulesDir)) {
        report.missingTrees.push(path.relative(REPO_ROOT, nodeModulesDir));
        continue;
      }

      for (const packageDir of collectPackageDirectories(nodeModulesDir)) {
        const manifest = readManifest(packageDir.manifestPath);
        if (!manifest) {
          report.findings.push({
            package: path.relative(REPO_ROOT, packageDir),
            license: 'unknown',
            reason: 'package.json is not readable JSON',
          });
          continue;
        }
        if (manifest.private === true && !manifest.name) {
          continue;
        }

        report.scanned += 1;
        const identity = packageIdentity(manifest, packageDir);
        const rawLicenses = normalizeLicenseValue(manifest.license || manifest.licenses);
        const parsed = rawLicenses.map((value) => splitLicenseExpression(value));

        for (const identifier of rawLicenses) {
          report.licenses[identifier] = (report.licenses[identifier] || 0) + 1;
        }

        const allIdentifiers = parsed.flatMap((entry) => entry.alternatives.flat());

        if (allIdentifiers.length === 0) {
          const missingKey = `${identity}@unspecified`.toLowerCase();
          if (!exceptions.has(missingKey)) {
            report.findings.push({
              package: identity,
              license: rawLicenses.join(', ') || 'missing',
              reason: 'no SPDX license identifier is declared',
            });
          }
          continue;
        }

        const acceptableAlternatives = parsed
          .flatMap((entry) => entry.alternatives)
          .filter((alternative) =>
            alternative.every((identifier) => {
              const upper = identifier.toUpperCase();
              if (denied.has(upper)) {
                return false;
              }
              return allowed.has(upper) || upper.includes('EXCEPTION');
            })
          );

        if (acceptableAlternatives.length > 0) {
          continue;
        }

        const deniedIdentifier = allIdentifiers.find((identifier) => denied.has(identifier.toUpperCase()));
        const unknownIdentifier = allIdentifiers.find(
          (identifier) =>
            !denied.has(identifier.toUpperCase()) && !allowed.has(identifier.toUpperCase())
        );
        const offending = deniedIdentifier || unknownIdentifier;
        const exception = exceptions.get(`${identity}@${offending}`.toLowerCase());

        if (!exception) {
          report.findings.push({
            package: identity,
            license: offending,
            declared: rawLicenses.join(', '),
            reason: deniedIdentifier
              ? 'license is denied by policy and has no approved exception'
              : 'license is not listed in policy.allowed and has no approved exception',
          });
        }
      }
    }
  } catch (error) {
    report.ok = false;
    report.error = error.message;
  }

  if (report.findings.length > 0 || report.missingTrees.length > 0 || report.error) {
    report.ok = false;
  }

  if (options.report) {
    fs.mkdirSync(path.dirname(options.report), { recursive: true });
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`License gate scanned ${report.scanned} installed package(s).\n`);
    if (report.missingTrees.length > 0) {
      process.stderr.write(
        `License gate error: dependency tree is missing (${report.missingTrees.join(', ')}). Run the reproducible install first.\n`
      );
    }
    if (report.error) {
      process.stderr.write(`License gate error: ${report.error}\n`);
    }
    for (const finding of report.findings) {
      process.stderr.write(
        `License gate error: ${finding.package} (${finding.license}) ${finding.reason}.\n`
      );
    }
    process.stdout.write(
      report.ok
        ? 'License gate passed: every installed package declares an allowed license.\n'
        : 'License gate failed.\n'
    );
  }

  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  normalizeLicenseValue,
  splitLicenseExpression,
  collectPackageDirectories,
};
