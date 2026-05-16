#!/usr/bin/env node
/**
 * Simulates EAS "npm ci --include=dev" in a clean directory (no local node_modules).
 * Run before eas build if installs fail mysteriously:
 *   node scripts/verify-npm-ci.cjs
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lottopilot-npmci-'));

function copyRel(rel) {
  const src = path.join(root, rel);
  const dest = path.join(tmp, rel);
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true });
  } else {
    fs.copyFileSync(src, dest);
  }
}

try {
  copyRel('package.json');
  copyRel('package-lock.json');
  copyRel('patches');
  console.log('Running npm ci --include=dev in', tmp);
  execSync('npm ci --include=dev', {
    cwd: tmp,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1', CI: '1' },
  });
  console.log('OK: lockfile matches package.json and install succeeds.');
} catch (e) {
  console.error('\nIf you see EUSAGE / out of sync: run `npm install` locally, commit package-lock.json, push, rebuild.');
  console.error('On Windows EBUSY: close apps using node_modules, delete node_modules, retry.\n');
  process.exit(1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
