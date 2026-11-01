// Deterministic archives without dependencies: USTAR tar (as Python's tarfile writes it),
// gzip without a timestamp or file name, and the `ar` container of a Debian/webOS package.

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

export interface Entry {
  /** The archive path, without a trailing slash. */
  readonly name: string;
  readonly type: 'file' | 'directory' | 'symlink';
  /** File contents; empty for directories and symlinks. */
  readonly body?: Buffer;
  /** Symlink target. */
  readonly target?: string;
  readonly mode: number;
  /** Seconds since the epoch. */
  readonly mtime?: number;
  readonly uid?: number;
  readonly gid?: number;
}

const BLOCK = 512;
// Python's tarfile and GNU tar pad the archive to whole 10 KiB records.
const RECORD = 20 * BLOCK;
const TYPES = { file: '0', directory: '5', symlink: '2' } as const;

/** Writes `text` NUL-padded into a `length`-byte field; refuses text that does not fit. */
function put(header: Buffer, offset: number, length: number, text: string, what: string): void {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length > length) {
    throw new Error(`${what} is too long`);
  }
  bytes.copy(header, offset);
}

/** A numeric field: zero-padded octal and a NUL, as Python's tarfile writes them. */
function octal(header: Buffer, offset: number, length: number, n: number, what: string): void {
  if (!Number.isInteger(n) || n < 0 || n >= 8 ** (length - 1)) {
    throw new Error(`${what} out of range: ${n}`);
  }
  put(header, offset, length, `${n.toString(8).padStart(length - 1, '0')}\0`, what);
}

/** Splits a long name at a slash into USTAR's prefix (155 bytes) and name (100 bytes). */
export function splitName(name: string): [prefix: string, name: string] {
  if (Buffer.byteLength(name) <= 100) {
    return ['', name];
  }
  const parts = name.split('/');
  for (let i = 1; i < parts.length; i += 1) {
    const prefix = parts.slice(0, i).join('/');
    const rest = parts.slice(i).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100) {
      return [prefix, rest];
    }
  }
  throw new Error(`name is too long: ${name}`);
}

/** One 512-byte USTAR header. */
export function ustarHeader(entry: Entry): Buffer {
  const block = Buffer.alloc(BLOCK);
  const name = entry.type === 'directory' ? `${entry.name}/` : entry.name;
  const [prefix, short] = splitName(name);
  put(block, 0, 100, short, 'name');
  octal(block, 100, 8, entry.mode & 0o7777, 'mode');
  octal(block, 108, 8, entry.uid ?? 0, 'uid');
  octal(block, 116, 8, entry.gid ?? 0, 'gid');
  octal(block, 124, 12, entry.type === 'file' ? (entry.body?.length ?? 0) : 0, 'size');
  octal(block, 136, 12, entry.mtime ?? 0, 'mtime');
  block.write(' '.repeat(8), 148, 'latin1');
  block.write(TYPES[entry.type], 156, 'latin1');
  put(block, 157, 100, entry.target ?? '', 'linkname');
  block.write('ustar\u000000', 257, 'latin1');
  octal(block, 329, 8, 0, 'devmajor');
  octal(block, 337, 8, 0, 'devminor');
  put(block, 345, 155, prefix, 'prefix');
  let sum = 0;
  for (const byte of block) {
    sum += byte;
  }
  // Six octal digits and a NUL; the eighth byte stays a space
  block.write(`${sum.toString(8).padStart(6, '0')}\0`, 148, 'latin1');
  return block;
}

/** A tar archive of `entries`, in the order given. */
export function tar(entries: readonly Entry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    parts.push(ustarHeader(entry));
    if (entry.type === 'file' && entry.body && entry.body.length > 0) {
      parts.push(entry.body, Buffer.alloc((BLOCK - (entry.body.length % BLOCK)) % BLOCK));
    }
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  const size = parts.reduce((total, part) => total + part.length, 0);
  parts.push(Buffer.alloc((RECORD - (size % RECORD)) % RECORD));
  return Buffer.concat(parts);
}

/** gzip with no file name and a zero timestamp, so equal input gives equal bytes. */
export function gzip(data: Buffer): Buffer {
  return gzipSync(data, { level: 9 });
}

/** One `ar` member: a GNU-style name, zero metadata, mode 100644, and padding to even. */
export function arMember(name: string, data: Buffer): Buffer {
  const field = (text: string, width: number): string => {
    if (text.length > width) {
      throw new Error(`ar field too long: ${text}`);
    }
    return text.padEnd(width);
  };
  const head = `${field(`${name}/`, 16)}${field('0', 12)}${field('0', 6)}${field('0', 6)}${field('100644', 8)}${field(String(data.length), 10)}\`\n`;
  return Buffer.concat([
    Buffer.from(head, 'ascii'),
    data,
    data.length % 2 ? Buffer.from('\n') : Buffer.alloc(0),
  ]);
}

/** An `ar` archive of the members, in the order given. */
export function ar(members: ReadonlyArray<readonly [string, Buffer]>): Buffer {
  return Buffer.concat([Buffer.from('!<arch>\n'), ...members.map(([n, d]) => arMember(n, d))]);
}

/** Byte-wise (code point) order, like Python's sorted() on file names. */
export function byName(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a), Buffer.from(b));
}

/**
 * Entries for a file or directory tree on disk, like Python's tarfile.add(): real modes and
 * mtimes, directories before their sorted contents, symlinks inside kept as symlinks. The
 * top-level path itself is followed when it is a symlink. Owner is root (uid/gid 0).
 */
export function diskEntries(source: string, name: string, top = true): Entry[] {
  const stat = top ? fs.statSync(source) : fs.lstatSync(source);
  const mtime = Math.floor(stat.mtimeMs / 1000);
  const mode = stat.mode & 0o7777;
  if (stat.isSymbolicLink()) {
    return [{ name, type: 'symlink', target: fs.readlinkSync(source), mode, mtime }];
  }
  if (stat.isFile()) {
    return [{ name, type: 'file', body: fs.readFileSync(source), mode, mtime }];
  }
  if (stat.isDirectory()) {
    const children = fs.readdirSync(source).sort(byName);
    return [
      { name, type: 'directory', mode, mtime },
      ...children.flatMap((child) =>
        diskEntries(path.join(source, child), `${name}/${child}`, false),
      ),
    ];
  }
  throw new Error(`Cannot archive ${source}: not a file, directory or symlink`);
}
