// The Telnet bootstrap transport against a fake TV on loopback: option refusal, the
// completion-marker protocol, echo stripping, exit status and the timeouts.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { describe, it } from 'node:test';
import { completion, refusals, run, wire } from '../tools/telnet.mjs';

interface FakeTV {
  port: number;
  received: () => Buffer;
  close: () => void;
}

/**
 * A Telnet "TV": offers options, then echoes each line like a terminal and runs it in a
 * local /bin/sh, translating newlines to CRLF. `mode` breaks it in the ways a TV can fail.
 */
async function fakeTV(mode: 'shell' | 'silent' | 'mute' | 'hangup' = 'shell'): Promise<FakeTV> {
  let received = Buffer.alloc(0);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    if (mode !== 'mute') {
      // IAC DO ECHO, IAC WILL SUPPRESS-GO-AHEAD, IAC DONT LINEMODE, IAC WONT STATUS
      socket.write(
        Buffer.from([0xff, 0xfd, 0x01, 0xff, 0xfb, 0x03, 0xff, 0xfe, 0x22, 0xff, 0xfc, 0x05]),
      );
      socket.write('webOS TV login banner\r\n# ');
    }
    socket.on('data', (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const text = received.toString('latin1');
      const end = text.indexOf('\r\n');
      if (end === -1) {
        return;
      }
      const line = text.slice(text.indexOf('stty'), end);
      socket.write(`${line}\r\n`);
      if (mode === 'hangup') {
        socket.end();
        return;
      }
      if (mode === 'silent') {
        return;
      }
      const result = spawnSync('/bin/sh', ['-c', line], { stdio: ['ignore', 'pipe', 'ignore'] });
      socket.write(result.stdout.toString('utf8').replaceAll('\n', '\r\n'));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as net.AddressInfo).port,
    received: () => received,
    close: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close();
    },
  };
}

describe('telnet transport', () => {
  it('refuses every option and returns the status and output without the echo', async () => {
    const tv = await fakeTV();
    try {
      assert.deepEqual(await run('127.0.0.1', 'id -u >/dev/null; echo 0', 5, tv.port), [0, '0']);
      const sent = tv.received();
      // WONT for DO, DONT for WILL, DONT and WONT
      assert.deepEqual(
        [...sent.subarray(0, 12)],
        [0xff, 0xfc, 0x01, 0xff, 0xfe, 0x03, 0xff, 0xfe, 0x22, 0xff, 0xfe, 0x05],
      );
      assert.match(
        sent.subarray(12).toString('latin1'),
        /^stty -echo; echo '[A-Za-z0-9+/=]+' \| base64 -d \| \/bin\/sh; printf '\\nOWNTV_[0-9a-f]{24}:%s\\n' "\$\?"\r\n$/,
      );
    } finally {
      tv.close();
    }
  });

  it('carries multi-line scripts with quotes and reports their exit status', async () => {
    const tv = await fakeTV();
    try {
      const script = `set -e\nprintf '%s\\n' "it's" 'two  spaces'\necho "$((6 * 7))"\nexit 3\n`;
      assert.deepEqual(await run('127.0.0.1', script, 5, tv.port), [3, "it's\ntwo  spaces\n42"]);
    } finally {
      tv.close();
    }
  });

  it('gives up without a completion marker', async () => {
    for (const mode of ['silent', 'hangup'] as const) {
      const tv = await fakeTV(mode);
      try {
        await assert.rejects(
          run('127.0.0.1', 'echo 0', 1, tv.port),
          /^Error: TV did not return a command completion marker$/,
        );
      } finally {
        tv.close();
      }
    }
  });

  it('times out when the TV says nothing first', async () => {
    const tv = await fakeTV('mute');
    try {
      await assert.rejects(run('127.0.0.1', 'echo 0', 5, tv.port), /timed out/);
    } finally {
      tv.close();
    }
  });
});

describe('telnet protocol', () => {
  it('answers option negotiation like the Python regex did', () => {
    const replies = refusals(
      Buffer.from([0xff, 0xff, 0xfd, 0x18, 0x41, 0xff, 0xfb, 0x0a, 0xff, 0xfe]),
    );
    // IAC IAC is data; option 0x0a (newline) never matched `.`; a truncated command is ignored
    assert.deepEqual(
      replies.map((r) => [...r]),
      [[0xff, 0xfc, 0x18]],
    );
  });

  it('finds the marker and strips the echoed command line', () => {
    const marker = `OWNTV_${'0a'.repeat(12)}`;
    const echoed = `${wire('ls', marker).trimEnd()}\r\n`;
    const output = Buffer.from(`# ${echoed}a\r\nb\r\n\r\n${marker}:12\r\n# `);
    assert.deepEqual(completion(output, marker), [12, 'a\nb']);
    assert.equal(completion(Buffer.from(`${echoed}a\r\n`), marker), null);
    assert.deepEqual(completion(Buffer.from(`out\n${marker}:0\n`), marker), [0, 'out']);
  });
});
