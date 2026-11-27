const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  endpointKey,
  normalizePath,
  parseClientEndpoints,
  parseDocumentedEndpoints,
  parseExceptions,
  parseImplementedEndpoints,
} = require('../../scripts/check-api-contract');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function temporaryFile(name, content) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-contract-'));
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('static API contract gate', () => {
  it('normalises path parameters before comparing endpoints', () => {
    expect(normalizePath('/transformers/:id')).toBe('/transformers/:param');
    expect(normalizePath('/transformers/:transformerId')).toBe('/transformers/:param');
    expect(endpointKey('get', '/transformers/:id')).toBe('GET /transformers/:param');
  });

  it('reads the documented endpoints and the base path from the contract', () => {
    const markdown = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'api', 'overview.md'), 'utf8');
    const contract = parseDocumentedEndpoints(markdown);

    expect(contract.basePath).toBe('/api/v1');
    expect(contract.endpoints.has('GET /api/v1/transformers')).toBe(true);
    expect(contract.endpoints.has('POST /api/v1/imports/preview')).toBe(true);
    expect(contract.endpoints.has('GET /api/v1/exports/customers')).toBe(true);
  });

  it('reads the paths and methods the frontend client calls', () => {
    const clientSource = fs.readFileSync(
      path.join(REPO_ROOT, 'frontend', 'src', 'services', 'api.ts'),
      'utf8'
    );
    const client = parseClientEndpoints(clientSource);

    expect(client.has('POST /api/v1/auth/login')).toBe(true);
    expect(client.has('PUT /api/v1/auth/profile')).toBe(true);
    expect(client.has('GET /api/v1/transformers/:param')).toBe(true);
    expect(client.has('GET /api/v1/transformers')).toBe(true);
  });

  it('rejects an exception registry with an expired entry', () => {
    const registry = {
      version: 1,
      exceptions: [
        {
          id: 'expired-entry',
          type: 'undocumented-implementation',
          method: 'GET',
          path: '/api/v1/example',
          owner: 'owner',
          expiresAt: '2020-01-01',
          rationale: 'An exception that is no longer valid.',
        },
      ],
    };
    const result = parseExceptions(JSON.stringify(registry));

    expect(result.problems.join(' ')).toMatch(/expired/);
  });

  it('rejects an exception registry without an owner', () => {
    const registry = {
      version: 1,
      exceptions: [
        {
          id: 'ownerless-entry',
          type: 'undocumented-implementation',
          method: 'GET',
          path: '/api/v1/example',
          expiresAt: '2099-01-01',
          rationale: 'An exception without an accountable owner.',
        },
      ],
    };
    const result = parseExceptions(JSON.stringify(registry));

    expect(result.problems.join(' ')).toMatch(/owner/);
  });

  it('reports an undocumented implementation that is not registered', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-contract-'));
    const moduleDirectory = path.join(directory, 'backend', 'src', 'modules', 'auth');
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(moduleDirectory, 'authRoutes.js'),
      "router.get('/not-documented', (req, res) => res.json({}));\n"
    );

    const appSource = [
      "const authRoutes = require('./modules/auth/authRoutes');",
      "app.use('/api/v1/auth', authRoutes);",
    ].join('\n');

    const implementation = parseImplementedEndpoints(appSource, directory);

    expect(implementation.endpoints.has('GET /api/v1/auth/not-documented')).toBe(true);
  });

  it('treats a method-not-allowed guard as a documented error path', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-contract-'));
    const moduleDirectory = path.join(directory, 'backend', 'src', 'modules', 'measurements');
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(moduleDirectory, 'measurementRoutes.js'),
      [
        'router.post(\'/:transformerId\', (req, res, next) => {',
        "  return next(new AppError('not supported', 405, null, 'METHOD_NOT_ALLOWED'));",
        '});',
      ].join('\n')
    );

    const appSource = [
      "const measurementRoutes = require('./modules/measurements/measurementRoutes');",
      "app.use('/api/v1/measurements', measurementRoutes);",
    ].join('\n');

    const implementation = parseImplementedEndpoints(appSource, directory);

    expect(implementation.endpoints.size).toBe(0);
  });

  it('runs against the repository and passes with the tracked exceptions', () => {
    const { execFileSync } = require('child_process');
    const output = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'check-api-contract.js')],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );

    expect(output).toMatch(/Static API contract gate passed/);
  });

  it('fails when a documented endpoint is missing from the implementation', () => {
    const contractFile = temporaryFile(
      'contract.md',
      [
        '| Base path | `/api/v1` |',
        '| Method | Path | Request | Success |',
        '| `GET` | `/only-documented` | None | `200` |',
      ].join('\n')
    );

    const contract = parseDocumentedEndpoints(fs.readFileSync(contractFile, 'utf8'));
    expect(contract.endpoints.has('GET /api/v1/only-documented')).toBe(true);
    expect(contract.endpoints.has('GET /api/v1/not-in-the-implementation')).toBe(false);
  });
});
