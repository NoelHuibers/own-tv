// Line coverage of the unit tests, held against a baseline so it can't quietly drop.
//
//   pnpm coverage                 run the tests with coverage, report, compare to the baseline
//   pnpm coverage --update        the same, then store the new numbers as the baseline
//
// Uses Node's built-in coverage on the TV's Node 20.12, over the compiled output in
// build/node (tsc keeps it line-for-line close to the sources). Reports land in coverage/:
// lcov.info and summary.md (also appended to the job summary in CI).
//
// Fails when the total or an area drops more than TOLERANCE percentage points below the
// baseline (scripts/coverage-baseline.json). The tolerance absorbs small noise; a real drop
// is usually a new file or feature without tests.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface Lines {
  found: number;
  hit: number;
}

interface Row {
  key: string;
  now: number;
  before: number | undefined;
  drop: boolean;
}

const TOLERANCE = 1;
const AREAS = ['app', 'native', 'tools'] as const;
// build/node/scripts → the repository
const root = path.resolve(import.meta.dirname, '../../..');
const compiled = path.join(root, 'build/node');
const out = path.join(root, 'coverage');
const baselineFile = path.join(root, 'scripts/coverage-baseline.json');
const update = process.argv.includes('--update');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const run = spawnSync(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    `--test-reporter-destination=${path.join(out, 'lcov.info')}`,
    path.join(compiled, 'tests'),
  ],
  { cwd: root, stdio: 'inherit' },
);
if (run.status !== 0) {
  console.error('The tests failed.');
  process.exit(run.status ?? 1);
}

// Per file: lines found (LF) and hit (LH), only for shipped sources
const files = new Map<string, Lines>();
let current: Lines | null = null;
for (const line of fs.readFileSync(path.join(out, 'lcov.info'), 'utf8').split('\n')) {
  if (line.startsWith('SF:')) {
    const rel = path.relative(compiled, line.slice(3)).split(path.sep).join('/');
    const area = rel.split('/')[0];
    current = null;
    if (AREAS.some((a) => a === area)) {
      current = { found: 0, hit: 0 };
      files.set(rel, current);
    }
  } else if (current && line.startsWith('LF:')) {
    current.found = Number(line.slice(3));
  } else if (current && line.startsWith('LH:')) {
    current.hit = Number(line.slice(3));
  }
}

const pct = ({ found, hit }: Lines): number =>
  found ? Math.round((hit / found) * 10_000) / 100 : 100;
const sum = (list: Iterable<Lines>): Lines => {
  const total = { found: 0, hit: 0 };
  for (const f of list) {
    total.found += f.found;
    total.hit += f.hit;
  }
  return total;
};
const result: Record<string, number> = { total: pct(sum(files.values())) };
for (const area of AREAS) {
  result[area] = pct(
    sum([...files].filter(([f]) => f.startsWith(`${area}/`)).map(([, lines]) => lines)),
  );
}

const baseline: Record<string, unknown> = fs.existsSync(baselineFile)
  ? JSON.parse(fs.readFileSync(baselineFile, 'utf8'))
  : {};
const rows: Row[] = Object.entries(result).map(([key, now]) => {
  const stored = baseline[key];
  const before = typeof stored === 'number' ? stored : undefined;
  return { key, now, before, drop: before !== undefined && now < before - TOLERANCE };
});
const percent = (n: number | undefined): string => (n === undefined ? '–' : `${n.toFixed(2)} %`);

const md = [
  '## Coverage (lines)',
  '',
  '| Area | Now | Baseline | |',
  '| --- | ---: | ---: | --- |',
  ...rows.map(
    (r) =>
      `| ${r.key} | ${percent(r.now)} | ${percent(r.before)} | ${r.drop ? '❌ dropped' : '✅'} |`,
  ),
  '',
  // biome-ignore lint/security/noSecrets: HTML markup, not a credential
  '<details><summary>Per file</summary>',
  '',
  '| File | Lines | Covered |',
  '| --- | ---: | ---: |',
  ...[...files]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, v]) => `| ${f} | ${v.found} | ${percent(pct(v))} |`),
  '',
  '</details>',
  '',
].join('\n');
fs.writeFileSync(path.join(out, 'summary.md'), md);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
console.log(
  `\n${rows
    .map(
      (r) =>
        `${r.key.padEnd(8)} ${percent(r.now).padStart(8)}  (baseline ${percent(r.before)})${r.drop ? '  DROPPED' : ''}`,
    )
    .join('\n')}`,
);

if (update) {
  fs.writeFileSync(baselineFile, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nStored the baseline in ${path.relative(root, baselineFile)}.`);
} else if (rows.some((r) => r.drop)) {
  console.error(
    `\nCoverage dropped more than ${TOLERANCE} point(s) below the baseline. Add tests, or if the drop is intended, run: pnpm coverage --update`,
  );
  process.exit(1);
}
