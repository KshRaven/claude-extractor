// Dependency-free sanity checks: JS syntax, manifest validity, referenced files, version sync.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const ext = path.join(root, 'extension');
const errors = [];
const fail = (m) => errors.push(m);

const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

// Parse every JS file without running it (works the same under Node and Bun).
for (const f of [...walk(ext), ...walk(path.join(root, 'scripts')), ...walk(path.join(root, 'test'))]) {
  if (!f.endsWith('.js')) continue;
  const src = fs.readFileSync(f, 'utf8').replace(/^#!.*/, '');
  try { new vm.Script(`(function (exports, require, module, __filename, __dirname) {${src}\n})`, { filename: f }); }
  catch (e) { fail(`Syntax error in ${path.relative(root, f)}: ${e.message}`); }
}

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')); }
catch (e) { fail('manifest.json is not valid JSON: ' + e.message); }

if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  const refs = [
    ...Object.values(manifest.icons || {}),
    ...Object.values((manifest.action || {}).default_icon || {}),
    (manifest.action || {}).default_popup,
    ...(manifest.content_scripts || []).flatMap((c) => c.js || []),
  ].filter(Boolean);
  for (const r of refs) if (!fs.existsSync(path.join(ext, r))) fail(`manifest references missing file: ${r}`);

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== manifest.version) fail(`version mismatch: package.json ${pkg.version} vs manifest ${manifest.version}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('check: ok');
