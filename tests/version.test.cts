import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { VERSION } from '../app/version';
import { field } from './json.cjs';
import { ROOT } from './paths.cjs';

function text(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function json(file: string): unknown {
  return JSON.parse(text(file));
}

test('the app and its package carry one release version', () => {
  const version = field(json('package.json'), 'version');
  assert.ok(typeof version === 'string');
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal(field(json('app/appinfo.json'), 'version'), version, 'app/appinfo.json');
  assert.equal(VERSION, version, 'app/version.ts');
});

test('the TV runtime ships no development dependencies', () => {
  const dependencies = field(json('package.json'), 'dependencies');
  assert.ok(dependencies && typeof dependencies === 'object');
  assert.deepEqual(Object.keys(dependencies), ['ical.js']);
});
