const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEPLOY_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'deploy.yml');

const APPROVED_TRIVY_DIGEST =
  'aquasec/trivy:0.58.1@sha256:ab70a02200597efa04748f210f793936eb647cbcdb0ea69cc30b226d6f5a22c7';

function readDeployWorkflow() {
  return fs.readFileSync(DEPLOY_WORKFLOW, 'utf8');
}

/**
 * Returns the body of the named step of the named job.
 */
function stepBody(source, job, stepName) {
  const lines = source.split('\n');
  const jobStart = lines.findIndex((line) => line.trim() === `${job}:`);
  expect(jobStart).toBeGreaterThan(-1);

  const jobBody = lines.slice(jobStart + 1);
  const nextJob = jobBody.findIndex((line) => /^ {2}\S/.test(line));
  const jobLines = nextJob === -1 ? jobBody : jobBody.slice(0, nextJob);

  const stepStart = jobLines.findIndex((line) => line.includes(`name: ${stepName}`));
  expect(stepStart).toBeGreaterThan(-1);

  const stepLines = jobLines.slice(stepStart + 1);
  const nextStep = stepLines.findIndex((line) => /^ {6}- name:/.test(line));
  return (nextStep === -1 ? stepLines : stepLines.slice(0, nextStep)).join('\n');
}

describe('deploy workflow policy', () => {
  it('keeps the production approval gate on the production environment', () => {
    const source = readDeployWorkflow();

    expect(source).toMatch(/environment:\s*production/);
  });

  it('requires the signing key and always signs the release manifest', () => {
    const source = readDeployWorkflow();
    const body = stepBody(source, 'publish', 'Create and sign the release manifest');

    // The secret is passed into the step.
    expect(body).toMatch(/RELEASE_MANIFEST_SIGNING_KEY_B64:\s*\$\{\{\s*secrets\.RELEASE_MANIFEST_SIGNING_KEY_B64\s*\}\}/);
    // A missing key is a failure, not a fallback.
    expect(body).toMatch(/RELEASE_MANIFEST_SIGNING_KEY_B64 is not configured/);
    expect(body).toMatch(/exit 1/);
    // The signing argument is unconditional.
    expect(body).toMatch(/--sign "\$\{RUNNER_TEMP\}\/release-manifest\.key"/);
    expect(body).not.toMatch(/if \[\[ -n "\$\{RELEASE_MANIFEST_SIGNING_KEY_B64/);
    // The signature file must exist.
    expect(body).toMatch(/release-manifest\.json\.sig/);
  });

  it('requires the public key and the signature in the deploy job', () => {
    const source = readDeployWorkflow();
    const body = stepBody(source, 'deploy', 'Validate the release configuration locally');

    expect(body).toMatch(/RELEASE_MANIFEST_PUBLIC_KEY_B64 is not configured/);
    expect(body).toMatch(/export REQUIRE_RELEASE_MANIFEST_SIGNATURE=true/);
    expect(body).toMatch(/release manifest signature file .* is missing/);
    // The requirement is unconditional: there is no warning-only branch.
    expect(body).not.toMatch(/::warning::RELEASE_MANIFEST_PUBLIC_KEY_B64/);
    expect(body).not.toMatch(/if \[\[ -n "\$\{RELEASE_MANIFEST_PUBLIC_KEY_B64/);
  });

  it('copies the signature file to the host unconditionally', () => {
    const source = readDeployWorkflow();
    const body = stepBody(source, 'deploy', 'Copy the release bundle to the host');

    expect(body).toMatch(/release manifest signature file is missing/);
    expect(body).not.toMatch(/if \[\[ -f "\$\{RUNNER_TEMP\}\/release\/release-manifest\.json\.sig/);
    expect(body).toMatch(/release-manifest\.json\.sig"/);
  });

  it('pins the vulnerability scanner to the reviewed digest', () => {
    const source = readDeployWorkflow();

    // The scanner is not taken from a repository variable.
    expect(source).not.toMatch(/vars\.TRIVY_IMAGE/);
    expect(source).toContain(`TRIVY_IMAGE: ${APPROVED_TRIVY_DIGEST}`);
    expect(source).toContain(`APPROVED_TRIVY_IMAGE: ${APPROVED_TRIVY_DIGEST}`);
    // The publish job asserts that the reference is still the approved one.
    const body = stepBody(source, 'publish', 'Verify the vulnerability scanner reference');
    expect(body).toMatch(/is not the approved reference/);
    expect(body).toMatch(/is not an exact digest reference/);
  });

  it('supplies the exact bundle archive so the recorded checksum is verified', () => {
    const source = readDeployWorkflow();
    const body = stepBody(source, 'deploy', 'Validate the release configuration locally');

    expect(body).toMatch(/BUNDLE_ARCHIVE:\s*\$\{\{\s*runner\.temp\s*\}\}\/release\/sigap-release-\$\{\{\s*needs\.resolve\.outputs\.source_sha\s*\}\}\.tar\.gz/);
    expect(body).toMatch(/release bundle archive .* is missing/);
  });

  it('records the release environment and the rollback reference with the complete image set', () => {
    const source = readDeployWorkflow();
    const body = stepBody(source, 'deploy', 'Record the release environment and the rollback reference');

    expect(body).toMatch(/prepare-release-env\.sh/);
    expect(body).toMatch(/--backend-image/);
    expect(body).toMatch(/--frontend-image/);
    expect(body).toMatch(/--mongo-image/);
    expect(body).toMatch(/--caddy-image/);
    expect(body).toMatch(/--verify/);
    expect(body).toMatch(/No rollback reference was recorded/);
  });

  it('compares the effective host image set with the approved digests', () => {
    const source = readDeployWorkflow();
    const body = stepBody(source, 'deploy', 'Verify the effective host image set against the approved digests');

    expect(body).toMatch(/verify-host-image-set\.sh/);
    expect(body).toMatch(/steps\.approved\.outputs\.backend/);
    expect(body).toMatch(/steps\.approved\.outputs\.frontend/);
    expect(body).toMatch(/steps\.approved\.outputs\.mongo/);
    expect(body).toMatch(/steps\.approved\.outputs\.caddy/);
  });

  it('only deploys a revision that a successful CI run on an allowed ref authorised', () => {
    const source = readDeployWorkflow();

    // A pull request CI run never authorises a deployment.
    expect(source).toMatch(/does not authorise a deployment/);
    expect(source).toMatch(/run_event.*!= "push"/);
    // The allowed refs are the protected branch and the release tags.
    expect(source).toMatch(/RELEASE_PROTECTED_BRANCH/);
    expect(source).toMatch(/RELEASE_TAG_PATTERN/);
  });
});
