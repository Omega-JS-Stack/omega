#!/usr/bin/env node
/**
 * An upstream for refresh-timeout.test.js that completes the MCP handshake and
 * then STALLS on the tools/list read: the third of the refresh one-shot's
 * failure shapes (hang-server.js never handshakes; broken-list-server.js
 * answers the read with an error).
 *
 * It speaks the wire itself instead of running the SDK's Server (the idiom
 * hang-server.js already uses) for ONE reason: the test pins WHICH bound fired,
 * and the SDK's own load is ~100ms of the child's startup — enough, under lane
 * load, to spend the whole handshake budget and answer the refresh on the
 * connect deadline instead of the read one. A dependency-free child answers
 * initialize on its first stdin chunk, so only the read can ever run out of
 * budget. tools/list is simply never answered: nothing but a request deadline
 * ends that read, which is what the router's own budget has to answer instead
 * of the client waiting out the SDK's 60s default. This process stays alive
 * meanwhile (stdin holds the loop open), so a refresh that does not close its
 * transport leaves the child running.
 *
 * Extra argv is accepted and ignored: the test passes a unique tag argument as
 * its pgrep handle for child-liveness checks.
 */

const reply = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);

let buffered = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffered += chunk;

  const lines = buffered.split('\n');
  buffered = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);

    // Anything else — the initialized notification, the tools/list read the
    // whole fixture exists to stall — goes unanswered.
    if (message.method !== 'initialize') continue;

    reply(message.id, {
      // The version the client asked for: it accepts nothing it did not offer.
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'stall-list-server', version: '1.0.0' },
    });
  }
});
