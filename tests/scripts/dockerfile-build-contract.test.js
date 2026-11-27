const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), 'utf8');
}

describe('container build contracts', () => {
  it('declares every multi-stage base image before the first FROM instruction', () => {
    const frontendDockerfile = readRepositoryFile('frontend/Dockerfile');
    const firstFromIndex = frontendDockerfile.indexOf('FROM ');

    expect(firstFromIndex).toBeGreaterThan(-1);
    expect(frontendDockerfile.slice(0, firstFromIndex)).toMatch(
      /^ARG NODE_IMAGE=node:22\.13\.0-alpine@sha256:[0-9a-f]{64}$/m,
    );
    expect(frontendDockerfile.slice(0, firstFromIndex)).toMatch(
      /^ARG NGINX_IMAGE=nginxinc\/nginx-unprivileged:1-alpine3\.24@sha256:[0-9a-f]{64}$/m,
    );
    expect(frontendDockerfile).toMatch(/^FROM \$\{NODE_IMAGE\} AS build$/m);
    expect(frontendDockerfile).toMatch(/^FROM \$\{NGINX_IMAGE\} AS runtime$/m);
  });

  it('keeps the backend runtime image on the digest-pinned Node base', () => {
    const backendDockerfile = readRepositoryFile('backend/Dockerfile');
    const firstFromIndex = backendDockerfile.indexOf('FROM ');

    expect(firstFromIndex).toBeGreaterThan(-1);
    expect(backendDockerfile.slice(0, firstFromIndex)).toMatch(
      /^ARG NODE_IMAGE=node:22\.13\.0-alpine@sha256:[0-9a-f]{64}$/m,
    );
    expect(backendDockerfile).toMatch(/^FROM \$\{NODE_IMAGE\} AS dependencies$/m);
    expect(backendDockerfile).toMatch(/^FROM \$\{NODE_IMAGE\} AS runtime$/m);
  });

  it('applies signed operating-system updates in both runtime images', () => {
    const frontendDockerfile = readRepositoryFile('frontend/Dockerfile');
    const backendDockerfile = readRepositoryFile('backend/Dockerfile');

    expect(frontendDockerfile).toMatch(/^RUN apk upgrade --no-cache$/m);
    expect(frontendDockerfile).toMatch(/^USER root$/m);
    expect(frontendDockerfile).toMatch(/^USER 101$/m);
    expect(backendDockerfile).toMatch(/^RUN apk upgrade --no-cache$/m);
  });

  it('removes npm tooling that is not required by the backend runtime', () => {
    const backendDockerfile = readRepositoryFile('backend/Dockerfile');

    expect(backendDockerfile).toContain(
      'rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx',
    );
    expect(backendDockerfile).toMatch(/^USER sigap$/m);
  });
});
