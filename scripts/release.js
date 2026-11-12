#!/usr/bin/env node
// One-command release.   node scripts/release.js [patch|minor|major|x.y.z] [--push] [--dry]   (default: patch)
//   1. needs a clean git tree and notes in CHANGELOG.md ("## Unreleased", or an already-written "## <version>")
//   2. runs check + tests
//   3. bumps package.json + extension/manifest.json, stamps the changelog
//   4. commits "Release vX.Y.Z" and tags vX.Y.Z   (--push also pushes, which triggers the release workflow)
// Also: node scripts/release.js --notes <version>   prints that version's changelog section (used by CI).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const P = {
  pkg: path.join(root, 'package.json'),
  man: path.join(root, 'extension', 'manifest.json'),
  log: path.join(root, 'CHANGELOG.md'),
};
const read = (f) => fs.readFileSync(f, 'utf8');
const die = (m) => { console.error('release: ' + m); process.exit(1); };
const run = (cmd, args, opt = {}) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8', ...opt });

function section(log, title) {
  const lines = log.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim().toLowerCase() === '## ' + title.toLowerCase());
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return { start, end, body: lines.slice(start + 1, end).join('\n').trim(), lines };
}

const argv = process.argv.slice(2);

if (argv[0] === '--notes') {
  const s = section(read(P.log), (argv[1] || '').replace(/^v/, ''));
  if (!s || !s.body) die(`no changelog section for ${argv[1]}`);
  process.stdout.write(s.body + '\n');
  process.exit(0);
}

const flags = new Set(argv.filter((a) => a.startsWith('--')));
const bump = argv.find((a) => !a.startsWith('--')) || 'patch'; // default: patch
const dry = flags.has('--dry');

const current = JSON.parse(read(P.man)).version;
let next;
if (/^\d+\.\d+\.\d+$/.test(bump)) next = bump;
else {
  const [a, b, c] = current.split('.').map(Number);
  next = bump === 'major' ? `${a + 1}.0.0` : bump === 'minor' ? `${a}.${b + 1}.0` : bump === 'patch' ? `${a}.${b}.${c + 1}` : null;
}
if (!next) die(`bad bump "${bump}"`);
const tagOnly = next === current; // first release of the version already in the manifest: just tag it

const log = read(P.log);
const un = section(log, 'Unreleased');
const stamped = section(log, next); // already written as "## <next>" by hand
const useUnreleased = !tagOnly && !!(un && un.body);
if (!useUnreleased && !(stamped && stamped.body)) die(`add your changes under "## Unreleased" (or a "## ${next}" section) in CHANGELOG.md first`);

if (!dry) {
  if (run('git', ['status', '--porcelain']).stdout.trim()) die('git tree is not clean; commit or stash first');
  if (run('git', ['rev-parse', '-q', '--verify', `refs/tags/v${next}`]).status === 0) die(`tag v${next} already exists`);
}
for (const s of ['check.js', 'test.js']) {
  if (run(process.execPath, [path.join('scripts', s)], { stdio: 'inherit' }).status !== 0) die(`${s} failed`);
}

console.log(`release: ${tagOnly ? `tag v${next} (version files already at ${next})` : `${current} -> ${next}`}${dry ? ' (dry run, nothing written)' : ''}`);
if (dry) process.exit(0);

const git = (...a) => { const r = run('git', a, { stdio: 'inherit' }); if (r.status !== 0) die(`git ${a.join(' ')} failed`); };
const publish = () => {
  if (flags.has('--push')) { git('push', 'origin', 'HEAD'); git('push', 'origin', `v${next}`); console.log(`release: pushed v${next}; the Release workflow will publish the zips.`); }
  else console.log(`release: ${tagOnly ? "tagged" : "committed and tagged"} v${next}. Publish with:  git push origin HEAD && git push origin v${next}`);
};
if (tagOnly) { git('tag', '-a', `v${next}`, '-m', `v${next}`); publish(); process.exit(0); }

const setVersion = (file) => fs.writeFileSync(file, read(file).replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`));
setVersion(P.pkg);
setVersion(P.man);
if (useUnreleased) {
  un.lines.splice(un.start, 1, '## Unreleased', '', `## ${next}`);
  fs.writeFileSync(P.log, un.lines.join('\n'));
}

git('add', 'package.json', 'extension/manifest.json', 'CHANGELOG.md');
git('commit', '-m', `Release v${next}`);
git('tag', '-a', `v${next}`, '-m', `v${next}`);
publish();