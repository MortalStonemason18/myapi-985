#!/usr/bin/env node
// Copies published skills from the repo root skills/ directory into src/skills/
// so they are bundled with the CLI package on publish.
import { existsSync, rmSync, mkdirSync, readdirSync, readFileSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const skillsSrc = join(repoRoot, 'skills');
const dest = join(__dirname, '..', 'src', 'skills');

if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

if (!existsSync(skillsSrc)) {
  console.log('copy-skills: skills/ directory not found, skipping.');
  process.exit(0);
}

const copied = [];
for (const service of readdirSync(skillsSrc)) {
  const pluginPath = join(skillsSrc, service, 'claude', '.claude-plugin', 'plugin.json');
  if (!existsSync(pluginPath)) continue;
  const plugin = JSON.parse(readFileSync(pluginPath, 'utf-8'));
  if (plugin.published !== true) continue;
  cpSync(join(skillsSrc, service), join(dest, service), { recursive: true });
  copied.push(service);
}

if (copied.length > 0) {
  console.log(`copy-skills: bundled ${copied.join(', ')}`);
} else {
  console.log('copy-skills: no published skills found.');
}
