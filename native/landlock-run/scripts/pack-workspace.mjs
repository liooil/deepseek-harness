#!/usr/bin/env node
/**
 * Pack every workspace package into validation tarballs, in dependency order
 * (platform packages first, then the entries that optionally depend on them),
 * and write `package-order.txt` next to them. The pack commands produce the
 * install payload and run each package's `prepack` check, so a missing binary
 * or unbuilt `lib/` refuses here.
 *
 * Usage: `node scripts/pack-workspace.mjs [dest] [--current-platform-only]`.
 * The flag packs only this host's platform package plus the entries for
 * per-architecture CI legs, where the other architecture's binary is absent.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { entryDirs, platformDirs, readJson, root } from './repo.mjs';

const args = process.argv.slice(2);
const currentPlatformOnly = args.includes('--current-platform-only');
const destination = path.resolve(args.find((arg) => !arg.startsWith('--')) || path.join(root, 'dist', 'npm'));

function hostPlatformDirs() {
  const hostPlatform = `${process.platform}-${process.arch}`;
  return platformDirs().filter((dir) => readJson(path.join(root, dir, 'prebuilds.json')).platform === hostPlatform);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function tarballName(manifest) {
  if (manifest.name.startsWith('@')) {
    return `${manifest.name.slice(1).replace('/', '-')}-${manifest.version}.tgz`;
  }
  return `${manifest.name}-${manifest.version}.tgz`;
}

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });

const dirs = [...(currentPlatformOnly ? hostPlatformDirs() : platformDirs()), ...entryDirs()];
const platformSet = new Set(platformDirs());
const packageOrder = [];
for (const dir of dirs) {
  const manifest = readJson(path.join(root, dir, 'package.json'));
  // pnpm pack normalizes modes and strips the platform launcher's executable
  // bit. Platform packages have no workspace dependencies, so npm pack can
  // preserve the mode while entry packages use pnpm's workspace conversion.
  if (platformSet.has(dir)) {
    run('npm', ['pack', `./${dir}`, '--pack-destination', destination]);
  } else {
    run('pnpm', ['--dir', dir, 'pack', '--pack-destination', destination]);
  }

  const tarball = tarballName(manifest);
  const tarballPath = path.join(destination, tarball);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`expected pack output not found: ${tarballPath}`);
  }
  packageOrder.push(tarball);
}

fs.writeFileSync(path.join(destination, 'package-order.txt'), `${packageOrder.join('\n')}\n`);
console.log(`Packed ${packageOrder.length} packages into ${path.relative(root, destination)}`);
