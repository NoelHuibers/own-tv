// A disconnected browser preview of the built dashboard (build/app), on 127.0.0.1 only.
//
//   pnpm preview                  http://127.0.0.1:5173/index.html?preview=sample
//   pnpm preview --port 5174      another port (the browser tests use 5174)
//
// Static files only, read-only, no directory listings. The dashboard's preview modes
// (?preview=sample|empty|error) simulate the TV bridge, so nothing here talks to a TV.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

export function parsePort(argv: readonly string[]): number {
  const at = argv.indexOf('--port');
  if (at === -1) {
    return 5173;
  }
  const port = Number(argv[at + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Use --port with a number from 1 to 65535.');
  }
  return port;
}

/** The file under `root` that `url` names, or null when it would leave `root`. */
export function resolve(root: string, url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) {
    return null;
  }
  const file = path.join(root, pathname === '/' ? '/index.html' : pathname);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

export function serve(root: string): http.Server {
  return http.createServer((req, res) => {
    const file =
      req.method === 'GET' || req.method === 'HEAD' ? resolve(root, req.url ?? '/') : null;
    const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
    let body: Buffer | null = null;
    if (file && type) {
      try {
        body = fs.readFileSync(file);
      } catch {
        body = null;
      }
    }
    if (!body || !type) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
      return;
    }
    res.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

// build/node/tools → the repository
const repository = path.resolve(import.meta.dirname, '../../..');
if (process.argv[1] === import.meta.filename) {
  const app = path.join(repository, 'build/app');
  if (!fs.existsSync(path.join(app, 'index.html'))) {
    console.error('No build/app yet. Run: pnpm build');
    process.exit(1);
  }
  const port = parsePort(process.argv.slice(2));
  serve(app).listen(port, '127.0.0.1', () => {
    console.log(`Preview: http://127.0.0.1:${port}/index.html?preview=sample`);
  });
}
