// A loopback-only browser editor. All TV communication travels over SSH.
//
//   pnpm editor --ssh-config PATH --host HOST [--port 18765]
//
// Serves the built dashboard (build/app) in editor mode on 127.0.0.1, plus /integrations.
// Only same-origin requests carrying the X-OwnTV-Editor header reach the TV, and only for
// the fixed helper actions below. Nothing is logged: no private URLs, payloads or viewing data.

import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { main, optionValue, parse } from './cli.mjs';
import { APP, isMain, userPath } from './paths.mjs';
import { helperCommand, run, sshArgs, TimeoutError } from './ssh.mjs';

export const ACTIONS: ReadonlySet<string> = new Set([
  'state',
  'launch',
  'sleep',
  'screenOff',
  'lgHome',
  'settings',
  'preferences',
  'configure',
  'weather',
  'firmwareCheck',
  'releaseIdleApps',
  'memoryMode',
  'weatherSearch',
  'weatherDetails',
  'radar',
  'weatherSource',
  'calendarCatalog',
  'calendarSource',
  'directHome',
]);

const MAX_BODY = 65_536;
const APP_SCRIPT = '<script src="app.js"></script>';
const EDITOR_SCRIPT = '<script src="/editor-mode.js"></script>';

export interface InvokeOptions {
  /** The ssh program (tests substitute a stand-in). */
  readonly ssh?: string;
  /** Seconds before the connection is abandoned. */
  readonly timeout?: number;
}

/** Runs one helper action on the TV and returns its reply. */
export async function invoke(
  sshConfig: string,
  host: string,
  action: unknown,
  value?: unknown,
  options: InvokeOptions = {},
): Promise<unknown> {
  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    throw new Error('Unknown action');
  }
  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run(
      options.ssh ?? 'ssh',
      sshArgs(sshConfig, host, helperCommand(action, value)),
      options.timeout ?? 75,
    );
  } catch (error) {
    // Never the command or its payload: a calendar link is a password
    if (error instanceof TimeoutError) {
      throw new Error('TV connection timed out. Check SSH and retry.');
    }
    throw new Error('Could not run ssh. Check that OpenSSH is installed.');
  }
  let reply: unknown;
  try {
    reply = JSON.parse(result.stdout.toString('utf8'));
  } catch {
    throw new Error('TV connection failed. Check SSH and install the native helper.');
  }
  if (typeof reply !== 'object' || reply === null || Array.isArray(reply)) {
    throw new Error('TV connection failed. Check SSH and install the native helper.');
  }
  const record = reply as Record<string, unknown>;
  if (result.status !== 0 || record.ok === false) {
    throw new Error('error' in record ? String(record.error) : 'TV operation failed');
  }
  return reply;
}

export type Invoker = (
  sshConfig: string,
  host: string,
  action: unknown,
  value?: unknown,
) => Promise<unknown>;

export interface EditorOptions {
  readonly sshConfig: string;
  readonly host: string;
  /** The built dashboard (default build/app). */
  readonly app?: string;
  readonly invoke?: Invoker;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/vnd.microsoft.icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

/** index.html with the editor flag script before the app, or null when the app tag is missing. */
export function editorIndex(html: string): string | null {
  return html.includes(APP_SCRIPT)
    ? html.replaceAll(APP_SCRIPT, `${EDITOR_SCRIPT}${APP_SCRIPT}`)
    : null;
}

/**
 * The file under `root` a request path names, like Python's SimpleHTTPRequestHandler: query
 * and fragment dropped, percent-decoded, and empty, `.` and `..` segments removed, so the
 * result never leaves `root`. Keeps a trailing slash. Null for undecodable paths.
 */
export function translate(root: string, url: string): string | null {
  const raw = url.split('?', 1)[0]?.split('#', 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const parts = decoded.split('/').filter((part) => part !== '' && part !== '.' && part !== '..');
  const file = path.join(root, ...parts);
  return raw.endsWith('/') ? `${file}/` : file;
}

/** fs.statSync, or null for any path that cannot be stat'ed (missing, ENOTDIR, ...). */
function statOrNull(file: string): fs.Stats | null {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}

export function createEditor(options: EditorOptions): http.Server {
  const app = options.app ?? APP;
  const call = options.invoke ?? invoke;
  const server = http.createServer();
  const port = (): number => (server.address() as AddressInfo).port;

  const send = (
    res: http.ServerResponse,
    status: number,
    type: string,
    body: string | Buffer,
    head = false,
  ): void => {
    const data = typeof body === 'string' ? Buffer.from(body) : body;
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'Content-Length': data.length,
    });
    res.end(head ? undefined : data);
  };
  const json = (res: http.ServerResponse, data: unknown, status = 200): void =>
    send(res, status, 'application/json', JSON.stringify(data));

  const allowedHost = (req: http.IncomingMessage): boolean => {
    const host = req.headers.host;
    return host === `127.0.0.1:${port()}` || host === `localhost:${port()}`;
  };

  function serveFile(req: http.IncomingMessage, res: http.ServerResponse, head: boolean): void {
    const url = req.url ?? '/';
    const file = translate(app, url);
    const stat = file ? statOrNull(file) : undefined;
    let target = file;
    if (file && stat?.isDirectory()) {
      if (!file.endsWith('/')) {
        const [pathname = '', query] = url.split('?', 2);
        res.writeHead(301, {
          Location: `${pathname}/${query === undefined ? '' : `?${query}`}`,
          'Content-Length': 0,
        });
        res.end();
        return;
      }
      // An index file if there is one; never a directory listing
      target =
        ['index.html', 'index.htm']
          .map((name) => path.join(file, name))
          .find((f) => statOrNull(f)?.isFile()) ?? null;
    } else if (!stat?.isFile() || file?.endsWith('/')) {
      target = null;
    }
    let body: Buffer | null = null;
    try {
      body = target ? fs.readFileSync(target) : null;
    } catch {
      body = null;
    }
    if (!(target && body)) {
      send(res, 404, 'text/plain; charset=utf-8', 'File not found\n', head);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.length,
    });
    res.end(head ? undefined : body);
  }

  function get(req: http.IncomingMessage, res: http.ServerResponse, head: boolean): void {
    if (!allowedHost(req)) {
      json(res, { ok: false, error: 'Invalid host' }, 403);
      return;
    }
    const url = req.url ?? '/';
    if (url === '/editor-mode.js') {
      send(res, 200, 'text/javascript', 'window.OWN_TV_EDITOR=true;', head);
    } else if (url === '/integrations') {
      send(res, 200, 'text/html; charset=utf-8', INTEGRATIONS, head);
    } else if (url.startsWith('/api/')) {
      json(res, { ok: false, error: 'POST required' }, 405);
    } else if (['/', '/index.html'].includes(url.split(/[?#]/, 1)[0] ?? '')) {
      let html: string | null = null;
      try {
        html = editorIndex(fs.readFileSync(path.join(app, 'index.html'), 'utf8'));
      } catch {
        html = null;
      }
      if (html === null) {
        // Fail closed: without the flag script the page would act as the TV dashboard
        send(
          res,
          500,
          'text/plain; charset=utf-8',
          `build/app/index.html has no ${APP_SCRIPT}. Run pnpm build\n`,
          head,
        );
        return;
      }
      send(res, 200, 'text/html; charset=utf-8', html, head);
    } else {
      serveFile(req, res, head);
    }
  }

  async function post(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const origin = req.headers.origin;
    const expected = [`http://127.0.0.1:${port()}`, `http://localhost:${port()}`];
    if (
      !(
        allowedHost(req) &&
        origin !== undefined &&
        expected.includes(origin) &&
        req.headers['x-owntv-editor'] === '1'
      )
    ) {
      json(res, { ok: false, error: 'Untrusted request' }, 403);
      return;
    }
    if (req.url !== '/api/action') {
      json(res, { ok: false, error: 'Not found' }, 404);
      return;
    }
    try {
      const declared = req.headers['content-length'] ?? '0';
      if (!/^\d+$/.test(declared)) {
        throw new Error('Invalid Content-Length');
      }
      const length = Number(declared);
      if (!(length > 0 && length <= MAX_BODY)) {
        throw new Error('Request too large');
      }
      if (req.headers['content-type'] !== 'application/json') {
        throw new Error('JSON required');
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > length) {
          throw new Error('Request too large');
        }
        chunks.push(chunk as Buffer);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        throw new Error('JSON object required');
      }
      const request = body as Record<string, unknown>;
      json(res, await call(options.sshConfig, options.host, request.action, request.value));
    } catch (error) {
      json(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  // No request logging anywhere: no private URLs, payloads or viewing data in logs
  server.on('request', (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      try {
        get(req, res, req.method === 'HEAD');
      } catch {
        // An unexpected failure must not stop the editor, nor reveal a path
        if (res.headersSent) {
          res.destroy();
        } else {
          send(res, 500, 'text/plain; charset=utf-8', 'Internal error\n');
        }
      }
    } else if (req.method === 'POST') {
      post(req, res).catch(() => res.destroy());
    } else {
      send(res, 501, 'text/plain; charset=utf-8', 'Unsupported method\n');
    }
  });
  return server;
}

const INTEGRATIONS = String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Own TV · Private integrations</title><style>body{font:18px/1.6 system-ui;background:#111719;color:#e4e9e4;max-width:640px;margin:60px auto;padding:24px}input,button{font:inherit;padding:12px;width:100%;box-sizing:border-box;margin:8px 0;background:#202a2e;color:inherit;border:1px solid #506064;border-radius:8px}label{display:block;margin-top:20px}input[type=checkbox]{width:auto}button{cursor:pointer;background:#215748}small{color:#a7b6b2}</style><h1>Private integrations</h1><p>Saved to your TV over SSH. Nothing here enters Git, config exports, or an Own TV cloud.</p><form><fieldset><legend>Weather · Open-Meteo</legend><small>Optional. Your selected coordinates are sent to Open-Meteo. Use town-level coordinates.</small><label>Place name<input id="place" maxlength="80"></label><label>Latitude<input id="lat" type="number" min="-90" max="90" step="any"></label><label>Longitude<input id="lon" type="number" min="-180" max="180" step="any"></label></fieldset><fieldset><legend>Calendar subscription</legend><small>Google, Apple/iCloud, Proton, Outlook or another ICS feed. Read-only. Treat a subscription link as a password. Apple requires Public Calendar sharing; use a separate calendar if you do not want to publish your full agenda.</small><label>HTTPS or webcal subscription link<input id="feed" type="password" autocomplete="off"></label><button type="button" id="pasteCalendars">Paste calendar subscriptions</button><p id="importedCalendars"></p><label><input id="busy" type="checkbox" checked> Only show “Busy”, hide event titles</label></fieldset><p>Saving updates filled sections only. Blank fields preserve your current connections. A new calendar link or bundle replaces your calendar connections; include every calendar you want to keep.</p><button>Save privately to TV</button><button type="button" data-disconnect="calendar">Disconnect calendar</button><button type="button" data-disconnect="weather">Disable weather</button></form><p id="result" role="status"></p><a href="/" style="color:#9ae2cf">Back to dashboard</a><script>pasteCalendars.onclick=async()=>{try{const text=await navigator.clipboard.readText();let data;if(/^\s*\{/.test(text)){try{data=JSON.parse(text);}catch{throw Error('Clipboard data is not a calendar bundle.');}}else data={kind:'own-tv-calendar-subscriptions',feeds:[{label:'Calendar',feedUrl:text.trim()}]};if(data.kind!=='own-tv-calendar-subscriptions'||!Array.isArray(data.feeds)||!data.feeds.length||data.feeds.length>16)throw Error('Use a calendar subscription link or an Own TV calendar bundle.');window.ownTVImportedFeeds=data.feeds;if(typeof data.busyOnly==='boolean')busy.checked=data.busyOnly;importedCalendars.textContent=data.feeds.length+' calendars ready: '+data.feeds.map(f=>f.label||'Calendar').join(', ');result.textContent='Ready to save privately to TV.';}catch(e){result.textContent=e.name==='NotAllowedError'?'Allow clipboard access, then try again.':e.message;}};document.querySelector('form').onsubmit=async e=>{e.preventDefault();const value={};if(lat.value&&lon.value)value.weather={latitude:Number(lat.value),longitude:Number(lon.value),label:place.value};if(window.ownTVImportedFeeds?.length)value.calendar={feeds:window.ownTVImportedFeeds,busyOnly:busy.checked};else if(feed.value)value.calendar={feedUrl:feed.value,busyOnly:busy.checked};if(!Object.keys(value).length){result.textContent='Enter a weather location or calendar subscription link.';return;}try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-OwnTV-Editor':'1'},body:JSON.stringify({action:'configure',value})});const d=await r.json();if(!d.ok)throw Error(d.error);result.textContent='Saved to TV. The dashboard refreshes within one minute.';feed.value='';window.ownTVImportedFeeds=null;importedCalendars.textContent='';}catch(e){result.textContent=e.message;}};document.querySelectorAll('[data-disconnect]').forEach(b=>b.onclick=async()=>{try{const r=await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json','X-OwnTV-Editor':'1'},body:JSON.stringify({action:'configure',value:{[b.dataset.disconnect]:null}})});const d=await r.json();if(!d.ok)throw Error(d.error);result.textContent='Disconnected. Other integrations are preserved.';}catch(e){result.textContent=e.message;}});</script></html>`;

if (isMain(import.meta.url)) {
  await main(async () => {
    const parsed = parse(
      {
        prog: 'pnpm editor',
        description: 'A loopback-only browser editor. All TV communication travels over SSH.',
        options: [
          { name: 'ssh-config', required: true },
          { name: 'host', required: true },
          { name: 'port', integer: true, default: '18765' },
        ],
      },
      process.argv.slice(2),
    );
    const index = path.join(APP, 'index.html');
    if (!fs.existsSync(index)) {
      throw new Error('No build/app/index.html. Run pnpm build');
    }
    if (editorIndex(fs.readFileSync(index, 'utf8')) === null) {
      throw new Error(`build/app/index.html has no ${APP_SCRIPT}. Run pnpm build`);
    }
    const port = Number(optionValue(parsed, 'port'));
    const server = createEditor({
      sshConfig: userPath(optionValue(parsed, 'ssh-config')),
      host: optionValue(parsed, 'host'),
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    console.log(
      `Own TV editor: http://127.0.0.1:${port}/\nPrivate integrations: http://127.0.0.1:${port}/integrations`,
    );
    return 0;
  });
}
