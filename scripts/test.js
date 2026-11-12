// Runs the test suite with whichever runtime started this script (Node or Bun).
// Under `bun run`, `node` is a Bun shim that only runs files (it ignores subcommands such as
// `test`), so for Bun we call the real `bun` binary from PATH instead of process.execPath.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const bun = !!process.versions.bun;
const r = spawnSync(bun ? 'bun' : process.execPath, bun ? ['test'] : ['--test'], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  shell: bun && process.platform === 'win32',
});
if (r.error) { console.error('test: could not start runner: ' + r.error.message); process.exit(1); }
process.exit(r.status === null ? 1 : r.status);
