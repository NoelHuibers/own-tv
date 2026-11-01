import dns, { type LookupAddress } from 'node:dns';
import https from 'node:https';
import net, { type LookupFunction } from 'node:net';

export type Resolver = (
  host: string,
  options: { all: true; verbatim: boolean },
) => Promise<LookupAddress[]>;

export function publicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const n = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    return /^[23]/.test(n) && !/^2001:(?:0*:|db8:|10:|20:)/i.test(n) && !n.startsWith('2002:');
  }
  return false;
}

export function feedUrl(value: unknown): string {
  const invalid = 'Enter a calendar subscription link (HTTPS or webcal).';
  if (typeof value !== 'string' || value.length > 8192) {
    throw new Error(invalid);
  }
  let u: URL;
  try {
    u = new URL(value.trim().replace(/^webcal:\/\//i, 'https://'));
  } catch {
    throw new Error(invalid);
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    (!host.includes('.') && !net.isIP(host)) ||
    /(^|\.)(localhost|local|internal|home|lan)$/.test(host) ||
    (net.isIP(host) && !publicAddress(host))
  ) {
    throw new Error('Use a public HTTPS calendar feed, without a login or custom port.');
  }
  if (u.pathname === '/' && !u.search) {
    throw new Error('Use the calendar subscription link, not the calendar website.');
  }
  return u.href;
}

export async function resolvePublic(
  host: string,
  resolver: Resolver = dns.promises.lookup,
): Promise<LookupAddress[]> {
  const entries = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await resolver(host, { all: true, verbatim: true });
  if (entries.length === 0 || entries.some((e) => !publicAddress(e.address))) {
    throw new Error('Calendar host must resolve to a public internet address.');
  }
  return entries;
}

export async function fetchCalendar(
  value: string,
  redirects = 0,
  expiresAt: number = Date.now() + 15000,
): Promise<string> {
  if (Date.now() >= expiresAt) {
    throw new Error('Calendar provider timed out.');
  }
  const u = new URL(feedUrl(value));
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let timer: NodeJS.Timeout | undefined;
  const entries = await Promise.race([
    resolvePublic(host),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Calendar DNS timed out.')),
        Math.min(10000, Math.max(1, expiresAt - Date.now())),
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const [first] = entries;
  if (!first) {
    throw new Error('Calendar host must resolve to a public internet address.');
  }
  return new Promise((resolve, reject) => {
    // Answer asynchronously: on Node 20 a synchronous answer lets an immediate
    // connect error (ENETUNREACH while waking from standby) reach the socket
    // before the request listens, crashing the whole Home router.
    const lookup: LookupFunction = (_hostname, options, cb) =>
      setImmediate(() => (options.all ? cb(null, entries) : cb(null, first.address, first.family)));
    const req = https.get(
      u,
      { lookup, timeout: 15000, headers: { Accept: 'text/calendar' } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
          res.resume();
          const location = res.headers.location;
          if (redirects >= 3 || !location) {
            reject(new Error('Calendar redirects could not be followed.'));
            return;
          }
          let next: string;
          try {
            next = new URL(location, u).href;
          } catch {
            reject(new Error('Invalid calendar redirect.'));
            return;
          }
          // Validate and pin DNS separately for every redirect, without forwarding credentials.
          resolve(fetchCalendar(next, redirects + 1, expiresAt));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Calendar provider returned HTTP ${String(res.statusCode)}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2000000) {
            req.destroy(new Error('Calendar feed is too large.'));
          } else {
            chunks.push(chunk);
          }
        });
        res.on('error', () => reject(new Error('Calendar connection failed.')));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (!/^\s*BEGIN:VCALENDAR\b/.test(text)) {
            reject(new Error('This link did not return an ICS calendar.'));
            return;
          }
          resolve(text);
        });
      },
    );
    const deadline = setTimeout(
      () => req.destroy(new Error('Calendar download timed out.')),
      Math.max(1, expiresAt - Date.now()),
    );
    req.on('close', () => clearTimeout(deadline));
    req.on('timeout', () => req.destroy(new Error('Calendar provider timed out.')));
    req.on('error', () => reject(new Error('Calendar connection failed.')));
  });
}
