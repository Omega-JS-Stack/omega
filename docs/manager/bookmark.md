# The bookmark service — brand links into Chrome

The `bookmark` service pushes the brand's console and dashboard links to the OMEGA Companion
extension over the WebSocket protocol; the extension files them under `Ω / {Brand} /
{Category}`. It runs at the very end of the walk and is interactive-only.

The extension is not this package's to ship ([#927](https://github.com/Omega-JS-Stack/omega/issues/927)):
it is the OMEGA brand's own extension target, `omega-omega/targets/extension`. Install the OMEGA
Companion from the Chrome Web Store, or load `omega-omega/targets/extension/packaged/chrome/raw/`
unpacked at `chrome://extensions` (`npx omega build` in that target writes it). It dials
`ws://localhost:9876`; `OMEGA_EXTENSION_PORT` moves the manager's side of that socket.

## What it reconciles

One operation, `sync`: start the WebSocket server the extension auto-connects to (it retries
every 5s), send one `OMEGA_BOOKMARK_SYNC` message, and wait for the extension's ack.

Link sources are the brand's own config and state, so groups with unmet inputs are simply
absent — a brand with no analytics ids gets no Analytics folder. Deployed Cloud Function names
(for per-function log links) come from a `gcloud` shell-out whose every failure — no gcloud, no
auth, no project — just means "no function links".

## Config and credentials

None of its own: everything is derived from the brand's existing config and state.

## Gotchas

- **A headless run skips cleanly** rather than burning the ten-second connect wait: there is no
  Chrome to talk to.
- **A dry run prints the link groups** it would sync without opening the server and without the
  gcloud lookup — no live reads.
