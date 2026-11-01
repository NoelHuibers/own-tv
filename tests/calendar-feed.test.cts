import assert from 'node:assert/strict';
import dns, { type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { type TestContext, test } from 'node:test';
import { feedUrl, fetchCalendar, publicAddress, resolvePublic } from '../native/calendar-feed.cjs';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const PUBLIC: LookupAddress[] = [{ address: '8.8.8.8', family: 4 }];

interface Get {
  readonly url: URL;
  readonly options: https.RequestOptions;
}

/** A calendar provider on 127.0.0.1 (plain HTTP). */
async function provider(t: TestContext, handler: http.RequestListener): Promise<number> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

/**
 * Routes the feed's HTTPS requests to the local provider: DNS answers with a public address
 * (so the address checks pass), and https.get is replaced by a plain request to 127.0.0.1
 * that keeps the path, headers and timeout. Both stubs are restored after the test.
 */
function route(t: TestContext, port: number, answer = PUBLIC, idleTimeout?: number) {
  const lookups = t.mock.method(dns.promises, 'lookup', () => Promise.resolve(answer));
  const gets: Get[] = [];
  t.mock.method(
    https,
    'get',
    (url: URL, options: https.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
      gets.push({ url, options });
      return http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: `${url.pathname}${url.search}`,
          headers: options.headers,
          timeout: idleTimeout ?? options.timeout,
        },
        callback,
      );
    },
  );
  return { lookups, gets };
}

test('calendar subscriptions accept normal providers and normalize webcal to HTTPS', () => {
  for (const u of [
    'https://calendar.google.com/calendar/ical/sample/private-token/basic.ics',
    'https://calendar.proton.me/api/calendar/v1/url/sample/calendar.ics',
    'https://outlook.live.com/owa/calendar/sample/calendar.ics',
    'https://calendar.example.com/feed.ics',
  ]) {
    assert.equal(feedUrl(u), u);
  }
  assert.equal(
    feedUrl('webcal://p01-caldav.icloud.com/published/2/sample'),
    'https://p01-caldav.icloud.com/published/2/sample',
  );
  for (const u of [
    'http://calendar.example.com/feed.ics',
    // biome-ignore lint/security/noSecrets: a credentialed link the validator must refuse
    'https://user:pass@calendar.example.com/feed.ics',
    'https://127.0.0.1/feed',
    'https://[::1]/feed',
    'https://calendar.local/feed',
    'https://calendar.example.com:8443/feed',
    'https://calendar.example.com/',
  ]) {
    assert.throws(() => feedUrl(u));
  }
  for (const u of [42, null, 'not a link', `https://calendar.example.com/${'a'.repeat(8192)}`]) {
    assert.throws(
      () => feedUrl(u),
      /^Error: Enter a calendar subscription link \(HTTPS or webcal\)\.$/,
    );
  }
});

test('calendar DNS blocks private, mixed and reserved routes before any connection', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '172.20.1.1',
    '192.168.1.1',
    '100.64.1.1',
    '198.18.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
    'fe80::1',
    '2001:db8::1',
    '2001::1',
  ]) {
    assert.equal(publicAddress(ip), false, ip);
  }
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('calendar.example.com'), false);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(
    resolvePublic('calendar.example.com', () =>
      Promise.resolve([
        { address: '8.8.8.8', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ]),
    ),
    /public/,
  );
  const entries = [{ address: '8.8.8.8', family: 4 }];
  assert.deepEqual(
    await resolvePublic('calendar.example.com', () => Promise.resolve(entries)),
    entries,
  );
});

test('feeds are downloaded with pinned DNS, a timeout and an ICS Accept header', async (t) => {
  const seen: http.IncomingHttpHeaders[] = [];
  const port = await provider(t, (req, res) => {
    seen.push(req.headers);
    res.end(ICS);
  });
  const { lookups, gets } = route(t, port);
  assert.equal(await fetchCalendar('webcal://calendar.example.com/feed.ics?key=1'), ICS);
  assert.equal(seen[0]?.accept, 'text/calendar');
  assert.equal(gets[0]?.url.href, 'https://calendar.example.com/feed.ics?key=1');
  assert.equal(gets[0]?.options.timeout, 15000);
  assert.deepEqual(lookups.mock.calls[0]?.arguments, [
    'calendar.example.com',
    { all: true, verbatim: true },
  ]);
});

test('the connection lookup answers asynchronously with the checked addresses only', async (t) => {
  const port = await provider(t, (_req, res) => res.end(ICS));
  const { gets } = route(t, port);
  await fetchCalendar('https://calendar.example.com/feed.ics');
  const lookup = gets[0]?.options.lookup;
  assert.ok(lookup);
  // Node 20 must not see a synchronous answer (an immediate connect error would escape)
  const answers: unknown[][] = [];
  const all = new Promise<void>((resolve) => {
    lookup('other.example', { all: true }, (...args: unknown[]) => {
      answers.push(args);
      resolve();
    });
  });
  const one = new Promise<void>((resolve) => {
    lookup('other.example', {}, (...args: unknown[]) => {
      answers.push(args);
      resolve();
    });
  });
  assert.equal(answers.length, 0);
  await Promise.all([all, one]);
  assert.deepEqual(answers, [
    [null, PUBLIC],
    [null, '8.8.8.8', 4],
  ]);
});

test('literal public addresses skip DNS, and private answers stop before connecting', async (t) => {
  const port = await provider(t, (_req, res) => res.end(ICS));
  const first = route(t, port);
  assert.equal(await fetchCalendar('https://8.8.4.4/calendar.ics'), ICS);
  assert.equal(first.lookups.mock.callCount(), 0);
  t.mock.restoreAll();
  const second = route(t, port, [
    { address: '8.8.8.8', family: 4 },
    { address: '192.168.1.10', family: 4 },
  ]);
  await assert.rejects(
    fetchCalendar('https://calendar.example.com/feed.ics'),
    /^Error: Calendar host must resolve to a public internet address\.$/,
  );
  assert.equal(second.gets.length, 0);
});

test('redirects are followed up to three times, each one validated and resolved again', async (t) => {
  const port = await provider(t, (req, res) => {
    const target: Record<string, string> = {
      '/old.ics': '/new.ics',
      '/private.ics': 'https://10.0.0.1/feed.ics',
      '/plain.ics': 'http://calendar.example.com/feed.ics',
      '/broken.ics': 'https://[',
      '/loop.ics': '/loop.ics',
    };
    const location = target[req.url ?? ''];
    if (req.url === '/nowhere.ics') {
      res.writeHead(302).end();
    } else if (location) {
      res.writeHead(req.url === '/old.ics' ? 301 : 307, { Location: location }).end();
    } else {
      res.end(ICS);
    }
  });
  const { lookups, gets } = route(t, port);
  assert.equal(await fetchCalendar('https://calendar.example.com/old.ics'), ICS);
  assert.deepEqual(
    gets.map((g) => g.url.href),
    ['https://calendar.example.com/old.ics', 'https://calendar.example.com/new.ics'],
  );
  assert.equal(lookups.mock.callCount(), 2);
  const url = (name: string) => `https://calendar.example.com/${name}`;
  await assert.rejects(fetchCalendar(url('private.ics')), /Use a public HTTPS calendar feed/);
  await assert.rejects(fetchCalendar(url('plain.ics')), /Use a public HTTPS calendar feed/);
  await assert.rejects(fetchCalendar(url('broken.ics')), /^Error: Invalid calendar redirect\.$/);
  await assert.rejects(
    fetchCalendar(url('nowhere.ics')),
    /^Error: Calendar redirects could not be followed\.$/,
  );
  gets.length = 0;
  await assert.rejects(
    fetchCalendar(url('loop.ics')),
    /^Error: Calendar redirects could not be followed\.$/,
  );
  assert.equal(gets.length, 4);
});

test('error statuses, non-calendar answers and oversized feeds are refused', async (t) => {
  const port = await provider(t, (req, res) => {
    if (req.url === '/missing.ics') {
      res.writeHead(404).end('Not found');
    } else if (req.url === '/page.ics') {
      res.end('<!doctype html><title>Sign in</title>');
    } else {
      res.on('error', () => {
        // The client hangs up mid-stream
      });
      const chunk = Buffer.alloc(65536, 'A');
      for (let i = 0; i < 40; i++) {
        res.write(chunk);
      }
      res.end();
    }
  });
  route(t, port);
  const url = (name: string) => `https://calendar.example.com/${name}`;
  await assert.rejects(
    fetchCalendar(url('missing.ics')),
    /^Error: Calendar provider returned HTTP 404$/,
  );
  await assert.rejects(
    fetchCalendar(url('page.ics')),
    /^Error: This link did not return an ICS calendar\.$/,
  );
  await assert.rejects(fetchCalendar(url('huge.ics')), /^Error: Calendar connection failed\.$/);
});

test('DNS, the overall deadline, an idle provider and refused connections all time out or fail', async (t) => {
  await assert.rejects(
    fetchCalendar('https://calendar.example.com/feed.ics', 0, Date.now() - 1),
    /^Error: Calendar provider timed out\.$/,
  );

  t.mock.method(dns.promises, 'lookup', () => new Promise<never>(() => undefined));
  const started = Date.now();
  await assert.rejects(
    fetchCalendar('https://calendar.example.com/feed.ics', 0, Date.now() + 50),
    /^Error: Calendar DNS timed out\.$/,
  );
  assert.ok(Date.now() - started < 5000);
  t.mock.restoreAll();

  let closed = 0;
  const port = await provider(t, (req) => {
    // Never answers
    req.socket.on('close', () => closed++);
  });
  route(t, port);
  await assert.rejects(
    fetchCalendar('https://calendar.example.com/feed.ics', 0, Date.now() + 100),
    /^Error: Calendar connection failed\.$/,
  );
  t.mock.restoreAll();
  route(t, port, PUBLIC, 50);
  await assert.rejects(
    fetchCalendar('https://calendar.example.com/feed.ics'),
    /^Error: Calendar connection failed\.$/,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(closed, 2);
  t.mock.restoreAll();

  // A port that was just closed refuses the connection
  const spare = http.createServer();
  await new Promise<void>((resolve) => spare.listen(0, '127.0.0.1', resolve));
  const address = spare.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve) => spare.close(() => resolve()));
  route(t, address.port);
  await assert.rejects(
    fetchCalendar('https://calendar.example.com/feed.ics'),
    /^Error: Calendar connection failed\.$/,
  );
});
