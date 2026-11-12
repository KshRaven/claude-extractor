// Builds store/sideload zips into dist/: one for Chromium browsers, one for Firefox.
// Uses the extension's own store-only zip writer, so there are no dependencies.
const fs = require('node:fs');
const path = require('node:path');

global.self = global;
require('../extension/lib/zip.js');

const ext = path.join(__dirname, '..', 'extension');
const dist = path.join(__dirname, '..', 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));

const walk = (d, base = '') => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), base + e.name + '/') : [base + e.name]));

async function build(target) {
  const m = JSON.parse(JSON.stringify(manifest));
  if (target === 'chromium') delete m.browser_specific_settings;
  const zip = new self.CX.Zip();
  const epoch = new Date(2026, 0, 1);
  for (const rel of walk(ext).sort()) {
    const data = rel === 'manifest.json' ? JSON.stringify(m, null, 2) + '\n' : new Uint8Array(fs.readFileSync(path.join(ext, rel)));
    zip.add(rel, data, epoch);
  }
  const out = path.join(dist, `claude-extractor-${manifest.version}-${target}.zip`);
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(out, Buffer.from(await zip.blob().arrayBuffer()));
  console.log('built', path.relative(process.cwd(), out));
}

(async () => { await build('chromium'); await build('firefox'); })();
