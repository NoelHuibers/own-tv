// Line coverage of the unit tests, held against a baseline so it can't quietly drop.
//
//   pnpm coverage                 run the tests with coverage, report, compare to the baseline
//   pnpm coverage --update        the same, then store the new numbers as the baseline
//
// Uses Node's built-in coverage, on the TV's Node 20.12. Reports land in coverage/: lcov.info and
// summary.md (also appended to the job summary in CI).
//
// Fails when the total or an area (app/, native/) drops more than TOLERANCE percentage
// points below the baseline (scripts/coverage-baseline.json). The tolerance absorbs small
// noise; a real drop is usually a new file or feature without tests.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TOLERANCE = 1;
const AREAS = ['app', 'native'];
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'coverage');
const baselineFile = path.join(root, 'scripts/coverage-baseline.json');
const update = process.argv.includes('--update');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const tests = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.cjs')).map((f) => path.join('tests', f));
const run = spawnSync(process.execPath, [
  '--test', '--experimental-test-coverage',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', `--test-reporter-destination=${path.join(out, 'lcov.info')}`,
  ...tests,
], { cwd: root, stdio: 'inherit' });
if (run.status !== 0) {
  console.error('The tests failed.');
  process.exit(run.status ?? 1);
}

// Per file: lines found (LF) and hit (LH), only for shipped sources
const files = {};
let current = null;
for (const line of fs.readFileSync(path.join(out, 'lcov.info'), 'utf8').split('\n')) {
  if (line.startsWith('SF:')) {
    const rel = path.relative(root, line.slice(3)).split(path.sep).join('/');
    current = null;
    if (AREAS.includes(rel.split('/')[0])) {
      current = { found: 0, hit: 0 };
      files[rel] = current;
    }
  } else if (current && line.startsWith('LF:')) current.found = Number(line.slice(3));
  else if (current && line.startsWith('LH:')) current.hit = Number(line.slice(3));
}

const pct = ({ found, hit }) => (found ? Math.round((hit / found) * 10000) / 100 : 100);
const sum = (list) => list.reduce((a, f) => ({ found: a.found + f.found, hit: a.hit + f.hit }), { found: 0, hit: 0 });
const result = { total: pct(sum(Object.values(files))) };
for (const area of AREAS) result[area] = pct(sum(Object.entries(files).filter(([f]) => f.startsWith(area + '/')).map(([, v]) => v)));

const baseline = fs.existsSync(baselineFile) ? JSON.parse(fs.readFileSync(baselineFile, 'utf8')) : {};
const rows = Object.keys(result).map((key) => {
  const before = baseline[key];
  const drop = typeof before === 'number' && result[key] < before - TOLERANCE;
  return { key, now: result[key], before, drop };
});

const md = [
  '## Coverage (lines)',
  '',
  '| Area | Now | Baseline | |',
  '| --- | ---: | ---: | --- |',
  ...rows.map((r) => `| ${r.key} | ${r.now.toFixed(2)} % | ${typeof r.before === 'number' ? r.before.toFixed(2) + ' %' : '–'} | ${r.drop ? '❌ dropped' : '✅'} |`),
  '',
  '<details><summary>Per file</summary>',
  '',
  '| File | Lines | Covered |',
  '| --- | ---: | ---: |',
  ...Object.entries(files).sort(([a], [b]) => a.localeCompare(b)).map(([f, v]) => `| ${f} | ${v.found} | ${pct(v).toFixed(2)} % |`),
  '',
  '</details>',
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log('\n' + rows.map((r) => `${r.key.padEnd(8)} ${r.now.toFixed(2).padStart(6)} %  (baseline ${typeof r.before === 'number' ? r.before.toFixed(2) + ' %' : 'none'})${r.drop ? '  DROPPED' : ''}`).join('\n'));

if (update) {
  fs.writeFileSync(baselineFile, JSON.stringify(result, null, 2) + '\n');
  console.log(`\nStored the baseline in ${path.relative(root, baselineFile)}.`);
} else if (rows.some((r) => r.drop)) {
  console.error(`\nCoverage dropped more than ${TOLERANCE} point(s) below the baseline. Add tests, or if the drop is intended, run: pnpm coverage --update`);
  process.exit(1);
}
