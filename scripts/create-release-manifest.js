#!/usr/bin/env node
'use strict';

/**
 * Creates the approved production release manifest.
 *
 * The manifest is the signed record that ties a rollout to an exact source
 * revision, an exact set of image digests, a bundle checksum, the evaluated
 * security and contract exceptions, and the recorded approval.
 *
 * Usage:
 *   node scripts/create-release-manifest.js --output <path> \
 *     --source-sha <sha> --bundle <archive> --approver <name> \
 *     --approved-at <iso> [--expires-in-hours <hours>] [--sign <private key>]
 *
 * The image references are read from the environment (BACKEND_IMAGE,
 * FRONTEND_IMAGE, MONGO_IMAGE, CADDY_IMAGE) so the manifest always records the
 * exact references that are scheduled for the rollout.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA_PATTERN = /^[0-9a-f]{64}$/;
const DIGEST_REFERENCE_PATTERN = /^([^\s@]+)@sha256:([0-9a-f]{64})$/;

function parseArguments(argv) {
  const options = {
    output: '',
    sourceSha: '',
    bundle: '',
    approver: '',
    approvedAt: '',
    expiresInHours: 24,
    signKey: '',
    releaseId: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const readValue = () => {
      index += 1;
      return argv[index] || '';
    };
    switch (argument) {
      case '--output':
        options.output = path.resolve(readValue());
        break;
      case '--source-sha':
        options.sourceSha = readValue();
        break;
      case '--bundle':
        options.bundle = path.resolve(readValue());
        break;
      case '--approver':
        options.approver = readValue();
        break;
      case '--approved-at':
        options.approvedAt = readValue();
        break;
      case '--expires-in-hours':
        options.expiresInHours = Number.parseInt(readValue(), 10);
        break;
      case '--sign':
        options.signKey = path.resolve(readValue());
        break;
      case '--release-id':
        options.releaseId = readValue();
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function countExceptions(relativePath) {
  const filePath = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    return 0;
  }
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed.exceptions) ? parsed.exceptions.length : 0;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function signManifest(manifestPath, signaturePath, privateKeyPath) {
  const attempts = [
    ['pkeyutl-ed25519', [
      'pkeyutl',
      '-sign',
      '-inkey',
      privateKeyPath,
      '-rawin',
      '-in',
      manifestPath,
      '-out',
      signaturePath,
    ]],
    ['dgst-sha256', [
      'dgst',
      '-sha256',
      '-sign',
      privateKeyPath,
      '-out',
      signaturePath,
      manifestPath,
    ]],
  ];

  const failures = [];
  for (const [name, args] of attempts) {
    try {
      execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      return { signed: true, method: name, failures };
    } catch (error) {
      failures.push(`${name}: ${(error.stderr || error.message).toString().trim()}`);
    }
  }

  throw new Error(`The release manifest could not be signed (${failures.join('; ')}).`);
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      'Usage: node scripts/create-release-manifest.js --output <path> --source-sha <sha> ' +
        '--bundle <archive> --approver <name> --approved-at <iso> [--expires-in-hours <hours>] [--sign <key>]\n'
    );
    return 0;
  }

  const problems = [];
  if (!options.output) {
    problems.push('--output <path> is required.');
  }
  if (!SOURCE_SHA_PATTERN.test(options.sourceSha)) {
    problems.push('--source-sha must be an exact 40 character lowercase commit SHA.');
  }
  if (!options.bundle || !fs.existsSync(options.bundle)) {
    problems.push('--bundle <archive> must point to an existing release bundle archive.');
  }
  if (!options.approver) {
    problems.push('--approver <name> is required; the recorded approval must name the approving operator.');
  }
  if (!options.approvedAt || !Number.isFinite(Date.parse(options.approvedAt))) {
    problems.push('--approved-at must be an ISO-8601 timestamp.');
  }
  if (!Number.isFinite(options.expiresInHours) || options.expiresInHours <= 0) {
    problems.push('--expires-in-hours must be a positive number.');
  }

  const images = {
    backend: process.env.BACKEND_IMAGE || '',
    frontend: process.env.FRONTEND_IMAGE || '',
    mongo: process.env.MONGO_IMAGE || '',
    caddy: process.env.CADDY_IMAGE || '',
  };
  for (const [name, value] of Object.entries(images)) {
    const match = DIGEST_REFERENCE_PATTERN.exec(value);
    if (!match) {
      problems.push(`${name.toUpperCase()}_IMAGE must be an exact <repository>@sha256:<64 hex> reference.`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) {
      process.stderr.write(`Release manifest error: ${problem}\n`);
    }
    return 1;
  }

  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + options.expiresInHours * 3600 * 1000);
  const releaseId =
    options.releaseId ||
    `sigap-${generatedAt.toISOString().replace(/[:.]/g, '-')}-${options.sourceSha.slice(0, 12)}`;

  const manifest = {
    manifestVersion: 1,
    releaseId,
    sourceSha: options.sourceSha,
    generatedAt: generatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    images,
    bundle: {
      name: path.basename(options.bundle),
      sha256: sha256File(options.bundle),
    },
    approvals: [
      {
        role: process.env.RELEASE_APPROVAL_ROLE || 'release-manager',
        approver: options.approver,
        approvedAt: new Date(options.approvedAt).toISOString(),
      },
    ],
    exceptionSummary: {
      vulnerabilityExceptions: countExceptions(path.join('security', 'vulnerability-exceptions.json')),
      licenseExceptions: countExceptions(path.join('security', 'license-exceptions.json')),
      contractExceptions: countExceptions(path.join('security', 'contract-gate-exceptions.json')),
    },
  };

  if (!SHA_PATTERN.test(manifest.bundle.sha256)) {
    process.stderr.write('Release manifest error: the bundle checksum could not be computed.\n');
    return 1;
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (options.signKey) {
    if (!fs.existsSync(options.signKey)) {
      process.stderr.write(`Release manifest error: the signing key '${options.signKey}' does not exist.\n`);
      return 1;
    }
    const signaturePath = `${options.output}.sig`;
    try {
      const result = signManifest(options.output, signaturePath, options.signKey);
      process.stdout.write(`Release manifest signed with ${result.method}: ${signaturePath}\n`);
    } catch (error) {
      process.stderr.write(`Release manifest error: ${error.message}\n`);
      return 1;
    }
  } else {
    process.stdout.write(
      'Release manifest created without a signature. Set a signing key before a production rollout; the deployment refuses an unsigned manifest when a signature is required.\n'
    );
  }

  process.stdout.write(`Release manifest written: ${options.output}\n`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { parseArguments, signManifest };
