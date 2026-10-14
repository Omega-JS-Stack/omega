// Unit tests for src/test/port-hold.js — the e2e lanes' classic-port hold.
//
// Real sockets, on a private high range: the module's whole promise is what a
// real bind does or does not see, and it never runs against the classic ports
// here (holding :4000 in a unit test would take a developer's dev server).

const defineCases = require('@omega.js/devkit/test/define-cases');
const net = require('node:net');
const { CLASSIC_PORTS, isPortFree } = require('@omega.js/config');

const { holdClassicPorts, releasePorts, holdAddress, CLASSIC_HOLD_PORTS } = require('../src/test/port-hold.js');

/** Can this address still be bound? (the allocator's question, one address of it) */
function bindable(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host }, () => server.close(() => resolve(true)));
  });
}

function listen(port, host) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.end('alive'));
    server.once('error', reject);
    server.listen({ port, host }, () => resolve(server));
  });
}

function connect(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host }, () => { socket.end(); resolve(true); });
    socket.once('error', reject);
  });
}

module.exports = defineCases({
  type: 'group',
  description: 'port-hold',
  tests: [
    {
      name: 'CLASSIC_HOLD_PORTS is every classic port plus the two HTTPS proxy ports, deduped',
      run: (ctx) => {
        for (const port of Object.values(CLASSIC_PORTS)) {
          ctx.expect(CLASSIC_HOLD_PORTS.includes(port), `the allocator starts from ${port} — it must be held`).toBeTruthy();
        }
        ctx.expect(CLASSIC_HOLD_PORTS.includes(4443), "web's internal HTTPS port").toBeTruthy();
        ctx.expect(CLASSIC_HOLD_PORTS.includes(5443), "the backend's internal HTTPS port").toBeTruthy();
        ctx.expect(CLASSIC_HOLD_PORTS.length, 'no port is held twice').toBe(new Set(CLASSIC_HOLD_PORTS).size);
      },
    },

    {
      name: 'a held port reads as taken to the allocator, and releasing gives it back',
      run: async (ctx) => {
        const ports = [46041, 46042];
        const hold = await holdClassicPorts(ports);

        try {
          ctx.expect(hold.held).toEqual(ports);
          ctx.expect(hold.busy).toEqual([]);
          const addresses = hold.servers.map((server) => `${server.address().address}:${server.address().port}`);
          ctx.expect(new Set(addresses).size, 'one listener per bound address').toBe(addresses.length);
          for (const server of hold.servers) {
            const { address } = server.address();
            ctx.expect(['127.0.0.1', '::1'].includes(address), `${address} must be a loopback bind, never the wildcard`).toBeTruthy();
          }
          for (const port of ports) {
            ctx.expect(await isPortFree(port), `:${port} must read as taken to the allocator while held`).toBe(false);
          }
        } finally {
          releasePorts(hold.servers);
        }

        for (const port of ports) {
          ctx.expect(await bindable(port, '127.0.0.1'), `:${port} must be free again after release`).toBe(true);
        }
      },
    },

    {
      name: "somebody else's live listener is reported busy and left completely alone",
      run: async (ctx) => {
        const port = 46043;
        const incumbent = await listen(port, '127.0.0.1');

        try {
          const hold = await holdClassicPorts([port]);
          ctx.expect(hold.busy).toEqual([port]);
          ctx.expect(hold.held).toEqual([]);
          // The partial binds are closed, not kept: SO_REUSEADDR would let a
          // more-specific socket win and steal their localhost traffic for the run.
          ctx.expect(hold.servers).toEqual([]);
          ctx.expect(await connect(port, '127.0.0.1'), 'their listener still answers').toBe(true);
          releasePorts(hold.servers);
        } finally {
          incumbent.close();
        }
      },
    },

    {
      name: "a foreign wildcard listener is busy to the default hold, and nothing is bound beside it",
      run: async (ctx) => {
        const port = 46059;
        const incumbent = await new Promise((resolve, reject) => {
          const server = net.createServer();
          server.once('error', reject);
          server.listen({ port }, () => resolve(server));
        });
        let hold = { servers: [] };

        try {
          hold = await holdClassicPorts([port]);
          ctx.expect(hold.busy).toEqual([port]);
          ctx.expect(hold.servers).toEqual([]);
        } finally {
          releasePorts(hold.servers);
          incumbent.close();
        }
      },
    },

    {
      name: 'a client holding a connection open never keeps a released port from closing',
      run: async (ctx) => {
        const port = 46045;
        const hold = await holdClassicPorts([port]);
        const accepted = Promise.race(hold.servers.map((server) => new Promise((resolve) => server.once('connection', resolve))));
        const client = net.connect({ port, host: '127.0.0.1' });
        client.on('error', () => {});

        try {
          await accepted;
          const closed = hold.servers.map((server) => new Promise((resolve) => server.once('close', () => resolve(true))));
          releasePorts(hold.servers);
          const ceiling = new Promise((resolve) => setTimeout(() => resolve(false), 2000).unref());
          for (const close of closed) {
            ctx.expect(await Promise.race([close, ceiling]), `a held listener on :${port} must close within 2 s of release`).toBe(true);
          }
        } finally {
          client.destroy();
        }
      },
    },

    {
      name: 'releasePorts is safe on an empty list and on already-closed listeners',
      run: async (ctx) => {
        const hold = await holdClassicPorts([46044]);
        releasePorts(hold.servers);
        releasePorts(hold.servers);
        releasePorts(undefined);
        ctx.expect(await bindable(46044, '127.0.0.1')).toBe(true);
      },
    },

    // ---- an address family this host does not have is NOT a busy port

    {
      name: 'a ::1 bind refused for want of IPv6 is not applicable, never busy',
      run: async (ctx) => {
        const seen = [];
        // The three codes a host with IPv6 off answers with. A hold that read them
        // as "busy" would report every classic port taken and bump the whole stack
        // for nothing.
        for (const code of ['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL']) {
          const bind = async (port, host) => {
            seen.push(host);
            if (host === '::1') return { status: 'unavailable' };
            return { status: 'held', server: { close: () => {} } };
          };

          const hold = await holdClassicPorts([46051], { bind, probe: async () => true });
          ctx.expect(hold.held, `${code} must not make the port busy`).toEqual([46051]);
          ctx.expect(hold.busy).toEqual([]);
          ctx.expect(hold.servers.length, 'the address that DOES exist is held').toBe(1);
        }
        ctx.expect(seen.slice(0, 2), 'every address is still attempted').toEqual(['127.0.0.1', '::1']);
      },
    },

    {
      name: 'the hold binds the two loopback addresses only, never the bare wildcard',
      run: async (ctx) => {
        const seen = [];
        const bind = async (port, host) => {
          seen.push(host);
          return { status: 'held', server: { close: () => {} } };
        };

        const hold = await holdClassicPorts([46054, 46055], { bind, probe: async () => true });

        // On Linux a wildcard listener collides with the holder's own loopback bind.
        ctx.expect(seen.includes(null), 'no bind carries a null (wildcard) host').toBe(false);
        ctx.expect(seen).toEqual(['127.0.0.1', '::1', '127.0.0.1', '::1']);
        ctx.expect(hold.held).toEqual([46054, 46055]);
        ctx.expect(hold.servers.length, 'one listener per bound address').toBe(4);
      },
    },

    {
      name: 'a port the probe reads as taken is busy, and no bind is attempted on it',
      run: async (ctx) => {
        const bound = [];
        const bind = async (port, host) => {
          bound.push(port);
          return { status: 'held', server: { close: () => {} } };
        };
        const probe = async (port) => port !== 46057;

        const hold = await holdClassicPorts([46056, 46057], { bind, probe });

        ctx.expect(hold.busy).toEqual([46057]);
        ctx.expect(hold.held).toEqual([46056]);
        ctx.expect(bound.includes(46057), 'a port the probe calls taken is never bound').toBe(false);
      },
    },

    {
      name: 'holdAddress classifies the real bind error: EADDRINUSE busy, missing family not applicable',
      run: async (ctx) => {
        // Real socket, real error: something else owns it, so the bind fails EADDRINUSE.
        const port = 46052;
        const incumbent = await listen(port, '127.0.0.1');
        try {
          ctx.expect(await holdAddress(port, '127.0.0.1')).toEqual({ status: 'busy' });
        } finally {
          incumbent.close();
        }

        // The address family branch, driven by an address this host cannot bind.
        const unavailable = await holdAddress(port, '203.0.113.7');
        ctx.expect(unavailable.status, 'EADDRNOTAVAIL is a family this host lacks, not an occupant').toBe('unavailable');
      },
    },

    {
      name: 'one busy address makes the whole port busy, and the partial binds are closed',
      run: async (ctx) => {
        const closed = [];
        const bind = async (port, host) => (host === '::1'
          ? { status: 'busy' }
          : { status: 'held', server: { close: () => closed.push(host) } });

        const hold = await holdClassicPorts([46053], { bind, probe: async () => true });

        ctx.expect(hold.busy).toEqual([46053]);
        ctx.expect(hold.held).toEqual([]);
        ctx.expect(hold.servers).toEqual([]);
        ctx.expect(closed, 'SO_REUSEADDR means a kept partial bind would steal their traffic').toEqual(['127.0.0.1']);
      },
    },
  ],
});
