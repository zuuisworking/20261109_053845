const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourceDirectory = path.join(root, '.temp', 'sigap');
const expected = new Map([
  ['Data Pelanggan (SupaBase).csv', 'AB2D7D3D69983AA61B9A218F1610DD1B65DCDC161C491CC0A3D8F9F504D88BD4'],
  ['Data Pelanggan.xlsx', 'F94F7E4FB8EF95B581BC5A782343D71ACA134FF17D68E5EF7A2B0259DA071E11'],
  ['Logo_PLN.png', '67AC91E8C8AB60E2337B3BAE43E5A9CDE83826E9103DB401F1556277681F700D'],
  ['Manajemen Trafo (SupaBase).csv', '17E46E48BC04AFC3F1825EADF5FE6240FEF2C9480087ABCC5EA9A169276125CC'],
  ['SIGAP ULP LABUHAN.html', 'F56FE763252AE594B089E31E8EBEE1CDD87004B1902385AE312D20C65B8880AB'],
  ['Tema_Utama.jfif', 'ACEE23AE3810132D5EFB4F43FD624E813D7DF4605410FB6F2819B7F0DDD4D7C1'],
]);

if (!fs.existsSync(sourceDirectory)) {
  console.log('Ground-truth directory is not present; verification skipped.');
  process.exit(0);
}

const actualNames = fs
  .readdirSync(sourceDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort();

const expectedNames = [...expected.keys()].sort();
if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
  console.error('Ground-truth inventory mismatch.');
  console.error('Expected:', expectedNames);
  console.error('Actual:', actualNames);
  process.exit(1);
}

let failed = false;
for (const [name, expectedHash] of expected) {
  const filePath = path.join(sourceDirectory, name);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
  if (hash !== expectedHash) {
    failed = true;
    console.error(`${name}: hash mismatch (expected ${expectedHash}, actual ${hash})`);
  }
}

if (failed) {
  process.exit(1);
}

console.log('Protected ground-truth inventory and SHA-256 hashes verified.');
