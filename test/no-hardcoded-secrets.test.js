const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const sourceDirectories = [
  'algorand',
  'contracts',
  'controllers',
  'middleware',
  'models',
  'routes',
  'services',
  'utils',
];
const sourceFiles = ['app.js', 'generate.js'];

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  });
}

test('runtime source contains no embedded credentials or direct environment access', () => {
  const files = [
    ...sourceDirectories.flatMap((directory) => collectJavaScriptFiles(path.join(projectRoot, directory))),
    ...sourceFiles.map((file) => path.join(projectRoot, file)),
  ];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(projectRoot, file);

    assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, `${relativePath} contains a JWT`);
    assert.doesNotMatch(source, /AKIA[0-9A-Z]{16}/, `${relativePath} contains an AWS access key`);
    assert.doesNotMatch(source, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, `${relativePath} contains a private key`);
    assert.doesNotMatch(source, /your-secret-key/, `${relativePath} contains the former fallback secret`);
    assert.doesNotMatch(source, /process\.env/, `${relativePath} bypasses centralized configuration`);
    assert.doesNotMatch(source, /require\(['"]dotenv['"]\)/, `${relativePath} loads environment configuration directly`);
    assert.doesNotMatch(source, /https?:\/\//, `${relativePath} contains a hard-coded service URL`);
  }
});

test('legacy vaccination asset publication is disabled', () => {
  const algorandSource = fs.readFileSync(path.join(projectRoot, 'algorand', 'algorand.js'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(projectRoot, 'controllers', 'vaccination.js'), 'utf8');

  assert.doesNotMatch(algorandSource, /makeAssetCreateTxn|assetName|assetURL|assetMetadataHash/);
  assert.doesNotMatch(controllerSource, /createVaccinationAssetImage|uploadToIPFS|generateCertificate/);
  assert.match(algorandSource, /CLINICAL_ASA_PUBLICATION_DISABLED/);
});
