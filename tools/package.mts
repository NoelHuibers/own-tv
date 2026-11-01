// Builds an unsigned webOS IPK from the built dashboard (build/app), with no SDK.
//
//   pnpm package                  writes dist/<id>_<version>_all.ipk and prints its path
//
// The bytes are reproducible: sorted entries, mtime 0, owner 0, mode 0644, deterministic gzip.

import fs from 'node:fs';
import path from 'node:path';
import { ar, byName, type Entry, gzip, tar } from './archive.mjs';
import { main, parse } from './cli.mjs';
import { APP, isMain, ROOT } from './paths.mjs';

/** Files that never enter the package: local device data, runtime overrides, source maps, keys. */
export function excluded(relative: string): boolean {
  const parts = relative.split('/');
  const name = parts.at(-1) ?? '';
  return (
    parts.some((part) => part.startsWith('.')) ||
    name === 'device.json' ||
    name === 'runtime.js' ||
    ['.map', '.key'].includes(path.extname(name))
  );
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const code =
        ref[1] === 'x' || ref[1] === 'X' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1));
      return code > 0 && code <= 0x10_ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

/**
 * The local references of an HTML page: `src` of each <script> and `href` of each <link>,
 * outside comments and script/style contents (as Python's HTMLParser saw them).
 */
export function references(html: string): string[] {
  const found: string[] = [];
  const tag = /<!--[\s\S]*?(?:-->|$)|<([a-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
  let match: RegExpExecArray | null = tag.exec(html);
  while (match) {
    const name = match[1]?.toLowerCase();
    if (name) {
      const attributes = new Map<string, string>();
      const attribute = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      for (const [, key = '', double, single, bare] of (match[2] ?? '').matchAll(attribute)) {
        // A repeated attribute keeps its last value, as dict(attrs) did
        attributes.set(key.toLowerCase(), decodeEntities(double ?? single ?? bare ?? ''));
      }
      const ref =
        name === 'script'
          ? attributes.get('src')
          : name === 'link'
            ? attributes.get('href')
            : undefined;
      if (ref) {
        found.push(ref);
      }
      if (name === 'script' || name === 'style') {
        const end = html.toLowerCase().indexOf(`</${name}`, tag.lastIndex);
        tag.lastIndex = end === -1 ? html.length : end;
      }
    }
    match = tag.exec(html);
  }
  return found;
}

/** Refuses an index.html that names a local script or stylesheet the app does not contain. */
export function checkReferences(app: string): void {
  for (const ref of references(fs.readFileSync(path.join(app, 'index.html'), 'utf8'))) {
    if (['https:', 'http:', '#', 'data:'].some((p) => ref.startsWith(p))) {
      continue;
    }
    let file = false;
    try {
      file = fs.statSync(path.join(app, ref)).isFile();
    } catch {
      file = false;
    }
    if (!file) {
      throw new Error(`Missing app asset: ${ref}`);
    }
  }
}

/** Every file under `dir`, as forward-slash paths relative to it, following file symlinks. */
function walk(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    const relative = `${prefix}${dirent.name}`;
    if (dirent.isDirectory()) {
      files.push(...walk(full, `${relative}/`));
    } else if (
      dirent.isFile() ||
      (dirent.isSymbolicLink() && fs.statSync(full, { throwIfNoEntry: false })?.isFile())
    ) {
      files.push(relative);
    }
  }
  return files;
}

function archive(files: ReadonlyMap<string, Buffer>): Buffer {
  const entries: Entry[] = [...files.keys()].sort(byName).map((name) => ({
    name: `./${name}`,
    type: 'file',
    body: files.get(name) ?? Buffer.alloc(0),
    mode: 0o644,
  }));
  return gzip(tar(entries));
}

export interface PackageOptions {
  /** The app directory (default build/app). */
  readonly app?: string;
  /** Where the .ipk goes (default dist/). */
  readonly out?: string;
}

/** Builds the IPK and returns its path. */
export function buildPackage(options: PackageOptions = {}): string {
  const app = options.app ?? APP;
  if (!fs.existsSync(path.join(app, 'index.html'))) {
    throw new Error(`No ${path.relative(ROOT, app) || app}/index.html. Run pnpm build`);
  }
  const meta: unknown = JSON.parse(fs.readFileSync(path.join(app, 'appinfo.json'), 'utf8'));
  const id = (meta as { id?: unknown }).id;
  const version = (meta as { version?: unknown }).version;
  if (
    typeof id !== 'string' ||
    typeof version !== 'string' ||
    !/^[\w.-]+$/.test(id) ||
    !/^[\w.+~-]+$/.test(version)
  ) {
    throw new Error('appinfo.json needs a plain string id and version');
  }
  checkReferences(app);
  const files = new Map<string, Buffer>();
  for (const relative of walk(app)) {
    if (!excluded(relative)) {
      files.set(
        `usr/palm/applications/${id}/${relative}`,
        fs.readFileSync(path.join(app, relative)),
      );
    }
  }
  files.set(
    `usr/palm/packages/${id}/packageinfo.json`,
    Buffer.from(JSON.stringify({ id, version, app: id })),
  );
  const size = [...files.values()].reduce((total, body) => total + body.length, 0);
  const control = [
    `Package: ${id}`,
    `Version: ${version}`,
    'Section: misc',
    'Priority: optional',
    'Architecture: all',
    `Installed-Size: ${Math.floor(size / 1024) + 1}`,
    'Maintainer: Own TV contributors',
    'Description: A personal webOS dashboard',
    'webOS-Package-Format-Version: 2',
    'webOS-Packager-Version: own-tv-1',
    '',
  ].join('\n');
  const data = ar([
    ['debian-binary', Buffer.from('2.0\n')],
    ['control.tar.gz', archive(new Map([['control', Buffer.from(control)]]))],
    ['data.tar.gz', archive(files)],
  ]);
  const out = options.out ?? path.join(ROOT, 'dist');
  fs.mkdirSync(out, { recursive: true });
  const ipk = path.join(out, `${id}_${version}_all.ipk`);
  fs.writeFileSync(ipk, data);
  return ipk;
}

if (isMain(import.meta.url)) {
  await main(() => {
    parse(
      {
        prog: 'pnpm package',
        description: 'Build an unsigned webOS IPK from build/app, no SDK needed.',
        options: [],
      },
      process.argv.slice(2),
    );
    console.log(buildPackage());
    return 0;
  });
}
