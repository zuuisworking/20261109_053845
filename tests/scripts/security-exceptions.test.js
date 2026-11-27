const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  isIsoDate,
  todayUtc,
  validateLicenseRegistry,
  validateVulnerabilityRegistry,
} = require('../../scripts/check-security-exceptions');

const { buildIgnoreEntries } = require('../../scripts/build-trivy-ignorefile');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function temporaryRegistry(content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-exceptions-'));
  const filePath = path.join(directory, 'registry.json');
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
  return filePath;
}

describe('security exception registries', () => {
  it('accepts the repository registries', () => {
    const vulnerabilityFile = path.join(REPO_ROOT, 'security', 'vulnerability-exceptions.json');
    const licenseFile = path.join(REPO_ROOT, 'security', 'license-exceptions.json');

    const vulnerabilityResult = validateVulnerabilityRegistry(
      JSON.parse(fs.readFileSync(vulnerabilityFile, 'utf8')),
      vulnerabilityFile
    );
    const licenseResult = validateLicenseRegistry(
      JSON.parse(fs.readFileSync(licenseFile, 'utf8')),
      licenseFile
    );

    expect(vulnerabilityResult.problems).toEqual([]);
    expect(licenseResult.problems).toEqual([]);
  });

  it('rejects a vulnerability exception without an advisory identifier', () => {
    const filePath = temporaryRegistry({
      version: 1,
      policy: { blockingSeverities: ['HIGH'] },
      exceptions: [
        {
          id: 'missing-advisory',
          package: 'example@1.0.0',
          severity: 'HIGH',
          owner: 'owner',
          expiresAt: '2099-01-01',
          riskTreatment: 'mitigated',
          rationale: 'An exception without an advisory identifier.',
          compensatingControls: ['control'],
        },
      ],
    });

    const result = validateVulnerabilityRegistry(JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath);

    expect(result.problems.join(' ')).toMatch(/advisory must be a CVE or GHSA identifier/);
  });

  it('rejects an expired vulnerability exception', () => {
    const filePath = temporaryRegistry({
      version: 1,
      policy: { blockingSeverities: ['HIGH'] },
      exceptions: [
        {
          id: 'expired-entry',
          advisory: 'CVE-2024-0001',
          package: 'example@1.0.0',
          severity: 'HIGH',
          owner: 'owner',
          expiresAt: '2020-01-01',
          riskTreatment: 'mitigated',
          rationale: 'An exception that is no longer valid.',
          compensatingControls: ['control'],
        },
      ],
    });

    const result = validateVulnerabilityRegistry(JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath);

    expect(result.problems.join(' ')).toMatch(/expired/);
  });

  it('rejects an exception without compensating controls', () => {
    const filePath = temporaryRegistry({
      version: 1,
      policy: { blockingSeverities: ['HIGH'] },
      exceptions: [
        {
          id: 'no-controls',
          advisory: 'CVE-2024-0002',
          package: 'example@1.0.0',
          severity: 'HIGH',
          owner: 'owner',
          expiresAt: '2099-01-01',
          riskTreatment: 'mitigated',
          rationale: 'An exception without any compensating control.',
          compensatingControls: [],
        },
      ],
    });

    const result = validateVulnerabilityRegistry(JSON.parse(fs.readFileSync(filePath, 'utf8')), filePath);

    expect(result.problems.join(' ')).toMatch(/compensatingControls/);
  });

  it('builds a trivy ignore file from the approved exceptions', () => {
    const entries = buildIgnoreEntries({
      exceptions: [
        {
          id: 'example-entry',
          advisory: 'CVE-2024-0003',
          package: 'example@1.0.0',
          severity: 'HIGH',
          owner: 'owner',
          expiresAt: '2099-01-01',
          riskTreatment: 'mitigated',
          rationale: 'An approved exception.',
          compensatingControls: ['control'],
        },
      ],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].vulnerabilityID).toBe('CVE-2024-0003');
    expect(entries[0].statement).toMatch(/owner=owner/);
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-12-31')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
    expect(todayUtc()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('runs the registry gate against the repository', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'check-security-exceptions.js')],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );

    expect(output).toMatch(/no expired entry/);
  });
});
