#!/usr/bin/env node
'use strict';

/**
 * Validates the repository-controlled security exception registries.
 *
 * The registries are the only way a dependency, container, or license finding
 * may be tolerated. Validation is intentionally strict and fails closed:
 *
 *   - every exception names an owner and an expiry date;
 *   - every exception states the risk treatment and the compensating controls;
 *   - an expired exception is a build failure, never a silent pass;
 *   - a malformed registry is a build failure.
 *
 * Usage:
 *   node scripts/check-security-exceptions.js [--vulnerability-file <path>]
 *                                            [--license-file <path>]
 *                                            [--json]
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const DEFAULT_VULNERABILITY_FILE = path.join(REPO_ROOT, 'security', 'vulnerability-exceptions.json');
const DEFAULT_LICENSE_FILE = path.join(REPO_ROOT, 'security', 'license-exceptions.json');

const ALLOWED_RISK_TREATMENTS = new Set([
  'mitigated',
  'accepted-with-controls',
  'false-positive',
  'will-fix',
]);

const ADVISORY_ID_PATTERN = /^(CVE-\d{4}-\d{4,}|GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4})$/;
const EXCEPTION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseArguments(argv) {
  const options = {
    vulnerabilityFile: DEFAULT_VULNERABILITY_FILE,
    licenseFile: DEFAULT_LICENSE_FILE,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--json') {
      options.json = true;
    } else if (argument === '--vulnerability-file') {
      index += 1;
      options.vulnerabilityFile = path.resolve(argv[index] || '');
    } else if (argument === '--license-file') {
      index += 1;
      options.licenseFile = path.resolve(argv[index] || '');
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Registry file is missing: ${path.relative(REPO_ROOT, filePath)}`);
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Registry file cannot be read: ${path.relative(REPO_ROOT, filePath)} (${error.message})`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Registry file is not valid JSON: ${path.relative(REPO_ROOT, filePath)} (${error.message})`);
  }
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function collectCommonExceptionProblems(entry, index, problems, label) {
  const prefix = `${label}.exceptions[${index}]`;

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    problems.push(`${prefix} must be an object.`);
    return;
  }
  if (typeof entry.id !== 'string' || !EXCEPTION_ID_PATTERN.test(entry.id)) {
    problems.push(`${prefix}.id must be a lowercase kebab-case identifier.`);
  }
  if (typeof entry.owner !== 'string' || entry.owner.trim().length < 2) {
    problems.push(`${prefix}.owner must name the accountable owner.`);
  }
  if (!isIsoDate(entry.expiresAt)) {
    problems.push(`${prefix}.expiresAt must be an ISO calendar date (YYYY-MM-DD).`);
  } else if (entry.expiresAt < todayUtc()) {
    problems.push(`${prefix}.expiresAt (${entry.expiresAt}) is in the past; the exception expired and must be renewed or removed.`);
  }
  if (typeof entry.rationale !== 'string' || entry.rationale.trim().length < 10) {
    problems.push(`${prefix}.rationale must explain why the finding is tolerated.`);
  }
}

function validateVulnerabilityRegistry(registry, filePath) {
  const problems = [];
  const label = path.relative(REPO_ROOT, filePath);

  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { problems: [`${label} must contain a JSON object.`], exceptionCount: 0 };
  }
  if (registry.version !== 1) {
    problems.push(`${label}.version must be 1.`);
  }
  if (!registry.policy || typeof registry.policy !== 'object') {
    problems.push(`${label}.policy is required.`);
  } else if (!Array.isArray(registry.policy.blockingSeverities) || registry.policy.blockingSeverities.length === 0) {
    problems.push(`${label}.policy.blockingSeverities must list at least one blocking severity.`);
  }
  if (!Array.isArray(registry.exceptions)) {
    problems.push(`${label}.exceptions must be an array.`);
    return { problems, exceptionCount: 0 };
  }

  const seenIds = new Set();
  registry.exceptions.forEach((entry, index) => {
    collectCommonExceptionProblems(entry, index, problems, label);

    if (!entry || typeof entry !== 'object') {
      return;
    }
    const prefix = `${label}.exceptions[${index}]`;
    if (seenIds.has(entry.id)) {
      problems.push(`${prefix}.id duplicates another exception id.`);
    }
    seenIds.add(entry.id);

    if (typeof entry.advisory !== 'string' || !ADVISORY_ID_PATTERN.test(entry.advisory)) {
      problems.push(`${prefix}.advisory must be a CVE or GHSA identifier.`);
    }
    if (typeof entry.package !== 'string' || entry.package.trim().length < 1) {
      problems.push(`${prefix}.package must identify the affected package, image, or module.`);
    }
    if (typeof entry.severity !== 'string' || entry.severity.trim().length < 1) {
      problems.push(`${prefix}.severity must record the scanner severity.`);
    }
    if (!ALLOWED_RISK_TREATMENTS.has(entry.riskTreatment)) {
      problems.push(
        `${prefix}.riskTreatment must be one of ${[...ALLOWED_RISK_TREATMENTS].join(', ')}.`
      );
    }
    if (!Array.isArray(entry.compensatingControls) || entry.compensatingControls.length === 0) {
      problems.push(`${prefix}.compensatingControls must list at least one control.`);
    }
    if (entry.riskTreatment === 'false-positive' && typeof entry.falsePositiveEvidence !== 'string') {
      problems.push(`${prefix}.falsePositiveEvidence must explain why the finding is a false positive.`);
    }
  });

  return { problems, exceptionCount: registry.exceptions.length };
}

function validateLicenseRegistry(registry, filePath) {
  const problems = [];
  const label = path.relative(REPO_ROOT, filePath);

  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    return { problems: [`${label} must contain a JSON object.`], exceptionCount: 0 };
  }
  if (registry.version !== 1) {
    problems.push(`${label}.version must be 1.`);
  }
  if (!registry.policy || typeof registry.policy !== 'object') {
    problems.push(`${label}.policy is required.`);
  } else {
    if (!Array.isArray(registry.policy.allowed) || registry.policy.allowed.length === 0) {
      problems.push(`${label}.policy.allowed must list the accepted license identifiers.`);
    }
    if (!Array.isArray(registry.policy.denied) || registry.policy.denied.length === 0) {
      problems.push(`${label}.policy.denied must list the rejected license identifiers.`);
    }
  }
  if (!Array.isArray(registry.exceptions)) {
    problems.push(`${label}.exceptions must be an array.`);
    return { problems, exceptionCount: 0 };
  }

  const seenIds = new Set();
  registry.exceptions.forEach((entry, index) => {
    collectCommonExceptionProblems(entry, index, problems, label);

    if (!entry || typeof entry !== 'object') {
      return;
    }
    const prefix = `${label}.exceptions[${index}]`;
    if (seenIds.has(entry.id)) {
      problems.push(`${prefix}.id duplicates another exception id.`);
    }
    seenIds.add(entry.id);

    if (typeof entry.package !== 'string' || entry.package.trim().length < 1) {
      problems.push(`${prefix}.package must identify the affected package.`);
    }
    if (typeof entry.license !== 'string' || entry.license.trim().length < 1) {
      problems.push(`${prefix}.license must record the detected license identifier.`);
    }
    if (!ALLOWED_RISK_TREATMENTS.has(entry.riskTreatment)) {
      problems.push(
        `${prefix}.riskTreatment must be one of ${[...ALLOWED_RISK_TREATMENTS].join(', ')}.`
      );
    }
    if (!Array.isArray(entry.compensatingControls) || entry.compensatingControls.length === 0) {
      problems.push(`${prefix}.compensatingControls must list at least one control.`);
    }
  });

  return { problems, exceptionCount: registry.exceptions.length };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/check-security-exceptions.js [--vulnerability-file <path>] [--license-file <path>] [--json]\n'
    );
    return 0;
  }

  const report = { ok: true, registries: [] };

  try {
    const vulnerabilityRegistry = readJsonFile(options.vulnerabilityFile);
    const vulnerabilityResult = validateVulnerabilityRegistry(vulnerabilityRegistry, options.vulnerabilityFile);
    report.registries.push({
      file: path.relative(REPO_ROOT, options.vulnerabilityFile),
      kind: 'vulnerability',
      exceptionCount: vulnerabilityResult.exceptionCount,
      problems: vulnerabilityResult.problems,
    });

    const licenseRegistry = readJsonFile(options.licenseFile);
    const licenseResult = validateLicenseRegistry(licenseRegistry, options.licenseFile);
    report.registries.push({
      file: path.relative(REPO_ROOT, options.licenseFile),
      kind: 'license',
      exceptionCount: licenseResult.exceptionCount,
      problems: licenseResult.problems,
    });
  } catch (error) {
    report.ok = false;
    report.error = error.message;
  }

  const problems = report.registries.flatMap((registry) => registry.problems);
  if (problems.length > 0) {
    report.ok = false;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    for (const registry of report.registries) {
      process.stdout.write(
        `${registry.file}: ${registry.exceptionCount} exception(s) checked.\n`
      );
    }
    if (report.error) {
      process.stderr.write(`Security exception registry error: ${report.error}\n`);
    }
    for (const problem of problems) {
      process.stderr.write(`Security exception registry error: ${problem}\n`);
    }
    process.stdout.write(
      report.ok
        ? 'Security exception registries are valid and contain no expired entry.\n'
        : 'Security exception registries failed validation.\n'
    );
  }

  return report.ok ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  ALLOWED_RISK_TREATMENTS,
  ADVISORY_ID_PATTERN,
  EXCEPTION_ID_PATTERN,
  isIsoDate,
  parseArguments,
  readJsonFile,
  todayUtc,
  validateLicenseRegistry,
  validateVulnerabilityRegistry,
};
