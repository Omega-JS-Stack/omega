# Offscreen Component

Offscreen documents persist in the background (unlike service workers, they don't sleep). Use for WebSocket connections, long-running tasks, audio, clipboard — anything an MV3 service worker can't hold.

**Key facts:**

- Only one offscreen document can exist per extension.
- Invisible — no UI, no styling needed.
- A light context: its `omega` is the extension base, with no @omega.js/client, no auth and no theme; see [contexts.md](contexts.md).
- Must be created programmatically from the background service worker.
- Requires the `offscreen` permission in the manifest (opt-in — see [components.md](components.md)).

## Creating from Background

```javascript
const OFFSCREEN_PATH = 'views/offscreen/index.html';

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function setupOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['WEB_RTC'],
    justification: 'Maintain persistent connection',
  });
}
```

## Offscreen ↔ Background Communication

Both sides talk over `omega.messenger`, the one lane between contexts ([contexts.md](contexts.md)): `send()` addresses a context by name and resolves with its answer, and `onMessage()` registers a handler for the messages addressed to this context. Never raw `chrome.runtime.sendMessage` / `onMessage`: the messenger drops a message addressed to another context, and background's holds every message until its session restore settles.

```javascript
// Offscreen → background (src/assets/js/components/offscreen/index.js)
const response = await omega.messenger.send({
  destination: 'background',
  command: 'myAction',
  payload: { data: {...} },
});

// Background, answering it (src/assets/js/components/background/index.js)
omega.messenger.onMessage((message, sender, sendResponse) => {
  if (message.command === 'myAction') {
    doSomething(message.payload.data).then(sendResponse);
    return true; // keep the channel open for the async answer
  }
});
```

Background reaches the offscreen document the same way, `destination: 'offscreen'`, and the offscreen side answers through its own `omega.messenger.onMessage`.

## See also

- [components.md](components.md) — the seven component contexts + manifest wiring
- [contexts.md](contexts.md): light vs page contexts, one `omega` each
- [extension.md](extension.md) — cross-browser API wrapper
