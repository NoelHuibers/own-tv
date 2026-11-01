// Builds the TV app package root, build/app: the dashboard's static files from app/
// (HTML, CSS, images, appinfo.json, map data) and app/main.ts bundled into one classic
// script, app.js. The TV loads the app from file://, where Chromium refuses ES-module
// scripts, hence one bundle rather than separate modules.

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

// build/node/scripts → the repository
const root = path.resolve(import.meta.dirname, '../../..');
const source = path.join(root, 'app');
const out = path.join(root, 'build/app');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(source, out, { recursive: true, filter: (file) => !file.endsWith('.ts') });

await build({
  entryPoints: [path.join(source, 'main.ts')],
  outfile: path.join(out, 'app.js'),
  bundle: true,
  format: 'iife',
  // webOS 11's web runtime (libcbe) is Chromium 132
  target: ['chrome132'],
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
});
