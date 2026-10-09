#!/usr/bin/env node
/**
 * Windows: when `npm ci` fails with EBUSY on a leftover node_modules/electron
 * tree, install prod dependencies in a temp dir and merge into ./node_modules
 * so `npx expo config` / `eas build` can resolve native config plugins.
 *
 * Does not install devDependencies (jest, patch-package, ts-node, etc.).
 * After locks are cleared, run full `npm ci` for local dev + tests.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lottopilot-nm-'));

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

try {
  copyFile(path.join(root, 'package.json'), path.join(tmp, 'package.json'));
  copyFile(path.join(root, 'package-lock.json'), path.join(tmp, 'package-lock.json'));
  execSync('npm ci --omit=dev --ignore-scripts', {
    cwd: tmp,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
  });
  const src = path.join(tmp, 'node_modules');
  const dst = path.join(root, 'node_modules');
  if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
  fs.cpSync(src, dst, { recursive: true, force: true });
  console.log('Merged production node_modules into project. Run: npx expo config --json');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
