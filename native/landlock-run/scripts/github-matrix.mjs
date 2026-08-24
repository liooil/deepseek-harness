#!/usr/bin/env node
/**
 * Derive the GitHub Actions CI matrix from the checked-in package matrix
 * (`packages/<name>/prebuilds.json`). Adding a platform extends CI without
 * editing the workflow.
 *
 *   node scripts/github-matrix.mjs ci  -> one leg per distinct platform
 */

import path from 'node:path';
import { platformDirs, readJson, root } from './repo.mjs';

/** GitHub runner per prebuilds.json `platform` value — native builders only, no cross toolchain. */
const RUNNERS = {
  'linux-x64': 'ubuntu-24.04',
  'linux-arm64': 'ubuntu-24.04-arm',
};

function runnerFor(platform) {
  const runner = RUNNERS[platform];
  if (!runner) {
    throw new Error(`missing GitHub runner for platform: ${platform}`);
  }
  return runner;
}

function platformManifests() {
  return platformDirs().map((dir) => readJson(path.join(root, dir, 'prebuilds.json')));
}

function ciMatrix() {
  const platforms = [...new Set(platformManifests().map(({ platform }) => platform))].sort();
  return {
    include: platforms.map((platform) => ({ platform, runner: runnerFor(platform) })),
  };
}

const target = process.argv[2];
if (target !== 'ci') {
  console.error('Usage: node scripts/github-matrix.mjs ci');
  process.exit(1);
}

process.stdout.write(JSON.stringify(ciMatrix()));
