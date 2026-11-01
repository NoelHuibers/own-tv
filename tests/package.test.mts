// The IPK the TV installs: layout, metadata, excluded files and reproducibility, plus the
// tar, gzip and ar writers behind it. A fixture app stands in for build/app; the real
// build/app is checked too when `pnpm build` has produced it.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  ar,
  arMember,
  diskEntries,
  type Entry,
  gzip,
  splitName,
  tar,
  ustarHeader,
} from '../tools/archive.mjs';
import { buildPackage, excluded, references } from '../tools/package.mjs';
import { APP, NATIVE } from '../tools/paths.mjs';
import { HELPERS, helperBundle } from '../tools/tv.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'own-tv-package-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));

/** `ar` members by name, read independently of the writer. */
function arMembers(data: Buffer): Map<string, Buffer> {
  assert.equal(data.subarray(0, 8).toString('latin1'), '!<arch>\n', 'not an ar archive');
  const members = new Map<string, Buffer>();
  let offset = 8;
  while (offset < data.length) {
    const head = data.subarray(offset, offset + 60).toString('latin1');
    assert.equal(head.slice(58, 60), '`\n');
    const name = head.slice(0, 16).trim().replace(/\/$/, '');
    const size = Number(head.slice(48, 58));
    members.set(name, data.subarray(offset + 60, offset + 60 + size));
    offset += 60 + size + (size % 2);
  }
  return members;
}

interface TarMember {
  name: string;
  type: string;
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
  link: string;
  body: Buffer;
}

/** The members of an uncompressed USTAR archive, checksums verified. */
function tarMembers(data: Buffer): TarMember[] {
  const text = (block: Buffer, start: number, length: number): string =>
    block
      .subarray(start, start + length)
      .toString('utf8')
      .replace(/\0.*$/s, '');
  const number = (block: Buffer, start: number, length: number): number =>
    Number.parseInt(text(block, start, length) || '0', 8);
  const members: TarMember[] = [];
  let offset = 0;
  while (offset + 512 <= data.length) {
    const block = data.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) {
      break;
    }
    assert.equal(block.subarray(257, 265).toString('latin1'), 'ustar\u000000');
    let sum = 0;
    for (let i = 0; i < 512; i += 1) {
      sum += i >= 148 && i < 156 ? 32 : (block[i] ?? 0);
    }
    assert.equal(number(block, 148, 8), sum, 'checksum');
    const prefix = text(block, 345, 155);
    const size = number(block, 124, 12);
    members.push({
      name: prefix ? `${prefix}/${text(block, 0, 100)}` : text(block, 0, 100),
      type: text(block, 156, 1),
      mode: number(block, 100, 8),
      uid: number(block, 108, 8),
      gid: number(block, 116, 8),
      mtime: number(block, 136, 12),
      link: text(block, 157, 100),
      body: data.subarray(offset + 512, offset + 512 + size),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return members;
}

const files = (blob: Buffer): Map<string, Buffer> =>
  new Map(
    tarMembers(gunzipSync(blob))
      .filter((m) => m.type === '0')
      .map((m) => [m.name.replace(/^\.\//, ''), m.body]),
  );

const META = { id: 'io.example.fixture', version: '1.2.3' };

/** A small built-dashboard stand-in, including every kind of file that must stay out. */
function fixture(name: string, index?: string): string {
  const app = path.join(temp, name);
  const write = (file: string, body: string | Buffer): void => {
    fs.mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
    fs.writeFileSync(path.join(app, file), body);
  };
  write(
    'index.html',
    index ??
      `<!doctype html><html><head><link rel="stylesheet" href="styles.css"><link rel="icon" href="data:,">
<link rel="preconnect" href="https://tilecache.rainviewer.com"></head><body><a href="#top">top</a>
<!-- <script src="commented-out.js"></script> -->
<script src="app.js"></script></body></html>`,
  );
  write('appinfo.json', JSON.stringify({ ...META, title: 'Fixture' }));
  write('app.js', 'window.app = 1;\n');
  write('styles.css', 'body{}\n');
  write('icon.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  write('data/geography.js', 'window.geo = [];\n');
  for (const secret of [
    'device.json',
    'runtime.js',
    'app.js.map',
    'tv.key',
    '.env',
    '.hidden/x.js',
    'data/.DS_Store',
    'data/device.json',
  ]) {
    write(secret, 'private');
  }
  return app;
}

describe('IPK', () => {
  const app = fixture('app');
  const ipk = buildPackage({ app, out: path.join(temp, 'dist') });
  const data = fs.readFileSync(ipk);
  const members = arMembers(data);

  it('has the webOS name and ar layout', () => {
    assert.equal(path.basename(ipk), `${META.id}_${META.version}_all.ipk`);
    assert.deepEqual([...members.keys()], ['debian-binary', 'control.tar.gz', 'data.tar.gz']);
    assert.equal(members.get('debian-binary')?.toString(), '2.0\n');
  });

  it('has control fields from appinfo.json', () => {
    const control =
      files(members.get('control.tar.gz') ?? Buffer.alloc(0))
        .get('control')
        ?.toString() ?? '';
    const size = [...files(members.get('data.tar.gz') ?? Buffer.alloc(0)).values()].reduce(
      (n, b) => n + b.length,
      0,
    );
    assert.equal(
      control,
      [
        `Package: ${META.id}`,
        `Version: ${META.version}`,
        'Section: misc',
        'Priority: optional',
        'Architecture: all',
        `Installed-Size: ${Math.floor(size / 1024) + 1}`,
        'Maintainer: Own TV contributors',
        'Description: A personal webOS dashboard',
        'webOS-Package-Format-Version: 2',
        'webOS-Packager-Version: own-tv-1',
        '',
      ].join('\n'),
    );
  });

  it('contains the app and nothing private', () => {
    const contents = files(members.get('data.tar.gz') ?? Buffer.alloc(0));
    const base = `usr/palm/applications/${META.id}/`;
    assert.deepEqual(
      [...contents.keys()],
      [
        `${base}app.js`,
        `${base}appinfo.json`,
        `${base}data/geography.js`,
        `${base}icon.png`,
        `${base}index.html`,
        `${base}styles.css`,
        `usr/palm/packages/${META.id}/packageinfo.json`,
      ],
    );
    assert.equal(
      JSON.parse(contents.get(`${base}appinfo.json`)?.toString() ?? '{}').version,
      META.version,
    );
    assert.deepEqual(
      JSON.parse(contents.get(`usr/palm/packages/${META.id}/packageinfo.json`)?.toString() ?? '{}'),
      {
        id: META.id,
        version: META.version,
        app: META.id,
      },
    );
    for (const body of contents.values()) {
      assert.notEqual(body.toString(), 'private');
    }
  });

  it('writes sorted root-owned 0644 files with ./ names and mtime 0', () => {
    for (const blob of [members.get('control.tar.gz'), members.get('data.tar.gz')]) {
      const list = tarMembers(gunzipSync(blob ?? Buffer.alloc(0)));
      const names = list.map((m) => m.name);
      assert.deepEqual(names, [...names].sort());
      for (const m of list) {
        assert.deepEqual([m.type, m.mode, m.uid, m.gid, m.mtime], ['0', 0o644, 0, 0, 0], m.name);
        assert.match(m.name, /^\.\//);
      }
      // gzip: deflate, no FNAME/FEXTRA/FCOMMENT flags, zero timestamp
      assert.deepEqual(
        [...(blob ?? Buffer.alloc(0)).subarray(0, 8)],
        [0x1f, 0x8b, 8, 0, 0, 0, 0, 0],
      );
    }
  });

  it('is reproducible', () => {
    const later = new Date('2030-01-02T03:04:05Z');
    for (const file of ['app.js', 'index.html', 'data/geography.js']) {
      fs.utimesSync(path.join(app, file), later, later);
    }
    fs.chmodSync(path.join(app, 'app.js'), 0o600);
    const again = buildPackage({ app, out: path.join(temp, 'dist-again') });
    assert.ok(fs.readFileSync(again).equals(data));
    assert.ok(
      fs
        .readFileSync(buildPackage({ app: fixture('copy'), out: path.join(temp, 'dist-copy') }))
        .equals(data),
    );
  });

  it('refuses a missing asset and a missing build', () => {
    const broken = fixture(
      'broken',
      '<html><script src="app.js"></script><SCRIPT SRC="missing.js"></SCRIPT></html>',
    );
    assert.throws(
      () => buildPackage({ app: broken, out: temp }),
      /^Error: Missing app asset: missing\.js$/,
    );
    const sheet = fixture(
      'sheet',
      '<link rel=stylesheet href=gone.css><script src="app.js"></script>',
    );
    assert.throws(() => buildPackage({ app: sheet, out: temp }), /Missing app asset: gone\.css/);
    assert.throws(
      () => buildPackage({ app: path.join(temp, 'nothing'), out: temp }),
      /Run pnpm build/,
    );
  });

  it('packages the real build/app', {
    skip: !fs.existsSync(path.join(APP, 'index.html')) && 'no build/app: run pnpm build',
  }, () => {
    const meta = JSON.parse(fs.readFileSync(path.join(APP, 'appinfo.json'), 'utf8'));
    const real = buildPackage({ out: path.join(temp, 'dist-real') });
    assert.equal(path.basename(real), `${meta.id}_${meta.version}_all.ipk`);
    const contents = files(arMembers(fs.readFileSync(real)).get('data.tar.gz') ?? Buffer.alloc(0));
    const base = `usr/palm/applications/${meta.id}/`;
    // Exactly build/app minus the excluded files, in the single-bundle layout
    const walk = (dir: string, prefix = ''): string[] =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((d) =>
          d.isDirectory()
            ? walk(path.join(dir, d.name), `${prefix}${d.name}/`)
            : [`${prefix}${d.name}`],
        );
    const expected = walk(APP).filter((name) => !excluded(name));
    assert.deepEqual(
      [...contents.keys()].filter((name) => name.startsWith(base)).sort(),
      expected.map((name) => base + name).sort(),
    );
    assert.deepEqual(
      [...contents.keys()].filter((name) => !name.startsWith(base)),
      [`usr/palm/packages/${meta.id}/packageinfo.json`],
    );
    for (const required of ['index.html', 'appinfo.json', 'app.js']) {
      assert.ok(contents.has(base + required), required);
    }
    assert.ok(
      contents.get(`${base}index.html`)?.toString().includes('<script src="app.js"></script>'),
      'index.html loads the app.js bundle',
    );
    assert.ok(
      fs
        .readFileSync(buildPackage({ out: path.join(temp, 'dist-real-2') }))
        .equals(fs.readFileSync(real)),
    );
  });
});

describe('asset references', () => {
  it('reads script src and link href like an HTML parser', () => {
    const html = `<link rel="stylesheet" href="a&amp;b.css"><LINK HREF='c.css'>
<!-- <script src="hidden.js"></script> --><script>const s = '<script src="inline.js"></script>';</script>
<script src=d.js defer></script><img src="e.png"><style>/* <link href="f.css"> */</style><script src="x.js" src="g.js"></script>`;
    assert.deepEqual(references(html), ['a&b.css', 'c.css', 'd.js', 'g.js']);
  });

  it('excludes private and generated files', () => {
    for (const name of [
      'device.json',
      'a/runtime.js',
      'app.js.map',
      'tv.key',
      '.env',
      'a/.git/config',
    ]) {
      assert.ok(excluded(name), name);
    }
    for (const name of ['app.js', 'data/geography.js', 'device.json.txt', 'key.js']) {
      assert.ok(!excluded(name), name);
    }
  });
});

describe('archive writer', () => {
  const entries: Entry[] = [
    { name: 'dir', type: 'directory', mode: 0o755, mtime: 1_700_000_000 },
    {
      name: 'dir/file.txt',
      type: 'file',
      body: Buffer.from('hello\n'),
      mode: 0o640,
      mtime: 1_700_000_001,
    },
    { name: 'empty', type: 'file', body: Buffer.alloc(0), mode: 0o600 },
    { name: 'block', type: 'file', body: Buffer.alloc(512, 1), mode: 0o644 },
    { name: 'link', type: 'symlink', target: 'dir/file.txt', mode: 0o777 },
    { name: `${'deep/'.repeat(30)}file.js`, type: 'file', body: Buffer.from('x'), mode: 0o644 },
  ];
  const archive = tar(entries);

  it('writes USTAR headers, padding and the end-of-archive blocks', () => {
    assert.equal(archive.length % 10_240, 0);
    const list = tarMembers(archive);
    assert.deepEqual(
      list.map((m) => [m.name, m.type, m.mode, m.mtime, m.link, m.body.toString()]),
      [
        ['dir/', '5', 0o755, 1_700_000_000, '', ''],
        ['dir/file.txt', '0', 0o640, 1_700_000_001, '', 'hello\n'],
        ['empty', '0', 0o600, 0, '', ''],
        ['block', '0', 0o644, 0, '', '\u0001'.repeat(512)],
        ['link', '2', 0o777, 0, 'dir/file.txt', ''],
        [`${'deep/'.repeat(30)}file.js`, '0', 0o644, 0, '', 'x'],
      ],
    );
    // Fields as Python's tarfile writes them: zero-padded octal, NUL; checksum "%06o\0 "
    const head = ustarHeader({ name: 'a', type: 'file', body: Buffer.from('abc'), mode: 0o644 });
    assert.equal(head.subarray(100, 108).toString('latin1'), '0000644\0');
    assert.equal(head.subarray(124, 136).toString('latin1'), '00000000003\0');
    assert.match(head.subarray(148, 156).toString('latin1'), /^[0-7]{6}\0 $/);
  });

  it('splits long names at a slash and refuses names that cannot fit', () => {
    assert.deepEqual(splitName('short'), ['', 'short']);
    const long = `${'p'.repeat(150)}/${'n'.repeat(99)}`;
    assert.deepEqual(splitName(long), ['p'.repeat(150), 'n'.repeat(99)]);
    assert.throws(() => splitName('n'.repeat(101)), /name is too long/);
    assert.throws(
      () => tar([{ name: 'l', type: 'symlink', target: 't'.repeat(101), mode: 0o777 }]),
      /linkname is too long/,
    );
  });

  it('is read the same by the system tar', {
    skip: spawnSync('tar', ['--version']).status !== 0 && 'no tar',
  }, () => {
    const out = path.join(temp, 'extract');
    fs.mkdirSync(out);
    const result = spawnSync('tar', ['-xf', '-', '-C', out], { input: archive });
    assert.equal(result.status, 0, result.stderr.toString());
    assert.equal(fs.readFileSync(path.join(out, 'dir/file.txt'), 'utf8'), 'hello\n');
    assert.equal(fs.statSync(path.join(out, 'dir/file.txt')).mode & 0o777, 0o640);
    assert.equal(fs.statSync(path.join(out, 'dir/file.txt')).mtimeMs, 1_700_000_001_000);
    assert.equal(fs.readlinkSync(path.join(out, 'link')), 'dir/file.txt');
    assert.equal(fs.readFileSync(path.join(out, `${'deep/'.repeat(30)}file.js`), 'utf8'), 'x');
    assert.equal(fs.statSync(path.join(out, 'block')).size, 512);
  });

  it('gzips deterministically', () => {
    assert.ok(gzip(archive).equals(gzip(archive)));
    assert.ok(gunzipSync(gzip(archive)).equals(archive));
  });

  it('writes ar members padded to an even length', () => {
    const odd = arMember('debian-binary', Buffer.from('abc'));
    assert.equal(odd.length, 60 + 4);
    assert.equal(
      odd.subarray(0, 60).toString('latin1'),
      `${'debian-binary/'.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${'3'.padEnd(10)}\`\n`,
    );
    assert.equal(odd.at(-1), 0x0a);
    assert.equal(arMember('x', Buffer.from('ab')).length, 62);
    assert.deepEqual(
      [
        ...arMembers(
          ar([
            ['a', Buffer.from('1')],
            ['b', Buffer.from('22')],
          ]),
        ),
      ],
      [
        ['a', Buffer.from('1')],
        ['b', Buffer.from('22')],
      ],
    );
  });

  it('archives a directory tree as it is on disk, following only the top symlink', () => {
    const tree = path.join(temp, 'tree');
    fs.mkdirSync(path.join(tree, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'package.json'), '{}');
    fs.writeFileSync(path.join(tree, 'lib/b.js'), 'b');
    fs.writeFileSync(path.join(tree, 'lib/a.js'), 'a', { mode: 0o600 });
    fs.symlinkSync('a.js', path.join(tree, 'lib/alias.js'));
    fs.symlinkSync(tree, path.join(temp, 'tree-link'));
    const list = diskEntries(path.join(temp, 'tree-link'), 'node_modules/pkg');
    assert.deepEqual(
      list.map((e) => [e.name, e.type]),
      [
        ['node_modules/pkg', 'directory'],
        ['node_modules/pkg/lib', 'directory'],
        ['node_modules/pkg/lib/a.js', 'file'],
        ['node_modules/pkg/lib/alias.js', 'symlink'],
        ['node_modules/pkg/lib/b.js', 'file'],
        ['node_modules/pkg/package.json', 'file'],
      ],
    );
    assert.equal(list[2]?.mode, 0o600);
    assert.equal(list[3]?.target, 'a.js');
  });
});

describe('TV helper bundle', () => {
  const built = HELPERS.every((name) => fs.existsSync(path.join(NATIVE, name)));
  it('ships the compiled helpers and real ical.js files', {
    skip: !built && 'no build/node/native helpers yet',
  }, () => {
    const list = tarMembers(helperBundle());
    const names = list.map((m) => m.name);
    assert.deepEqual(names.slice(0, HELPERS.length), [...HELPERS]);
    assert.ok(names.includes('holiday-catalog.json'));
    assert.ok(names.includes('compatibility/firmware.json'));
    const build = list.find((m) => m.name === 'build.json');
    assert.equal(build?.mode, 0o600);
    assert.equal(
      JSON.parse(build?.body.toString() ?? '{}').version,
      JSON.parse(fs.readFileSync(path.join(APP, '../../package.json'), 'utf8')).version,
    );
    const ical = list.find((m) => m.name === 'node_modules/ical.js/package.json');
    assert.equal(ical?.type, '0');
    assert.ok(list.every((m) => m.uid === 0 && m.gid === 0));
    assert.ok(
      !names.some((n) => /(^|\/)(node_modules\/(?!ical\.js)|\.env|.*\.key$)/.test(n)),
      'nothing unrelated',
    );
  });
});
