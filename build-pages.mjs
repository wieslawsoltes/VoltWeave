/** Stage the dependency-free application for GitHub Pages or any static HTTPS host. */
import { mkdir, rm, copyFile, cp, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const site = path.join(root, '_site');
execFileSync(process.execPath, ['build-standalone.mjs'], { cwd: root, stdio: 'inherit' });
await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await copyFile(path.join(root, 'dist/voltweave.html'), path.join(site, 'index.html'));
await copyFile(path.join(root, 'dist/voltweave.html'), path.join(site, 'voltweave.html'));
await cp(path.join(root, 'examples'), path.join(site, 'examples'), { recursive: true });
await writeFile(path.join(site, '.nojekyll'), '');
await writeFile(path.join(site, 'version.json'), JSON.stringify({
  name: 'VoltWeave', version: '1.0.0', commit: process.env.GITHUB_SHA || 'local',
  builtAt: new Date().toISOString()
}, null, 2) + '\n');
console.log('GitHub Pages site staged in _site/.');
