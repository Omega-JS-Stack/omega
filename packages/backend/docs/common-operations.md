# Common Operations

Inside-the-handler patterns for the most frequent operations. See [docs/routes.md](routes.md) for the route file structure itself.

## Authenticate User

```javascript
const user = await ctx.authenticate();
if (!user.authenticated) {
  return ctx.report('Authentication required', { code: 401 });
}
```

### A missing user doc heals here

A verified ID token whose `users/{uid}` doc is gone is a database out of sync with Auth, not a caller to turn away ([#405](https://github.com/Omega-JS-Stack/omega/issues/405)). `authenticate()` recreates the doc `auth:on-create` writes at signup, built from the Auth record by the one shared builder in [src/manager/libraries/user-doc.js](../src/manager/libraries/user-doc.js), warns naming the uid, and then authenticates the caller normally, so every signed-in surface heals at the same seam. A doc that exists but carries no `auth.uid` counts as missing **to the heal**: that is the residue `auth:before-signin` leaves on a doc-less account, and it is what the heal completes into a real account doc. Whether the caller authenticates is a separate question with an unchanged answer: a doc that exists at all authenticates its caller, healed or not. The healed doc is stamped `metadata.tag: 'auth:heal'` and `flags.signupProcessed: true`, since an established account must not be sent back through the signup flow (welcome emails, affiliate credit, marketing sync) on its next page load.

Three accounts are never healed, so the heal only ever completes an account that should already have a doc:

- **A signup still in flight.** Within `SIGNUP_WINDOW_MS` (two minutes) of the Auth record being created, the heal stands down. That first write is `auth:on-create`'s: it runs the consumer hook, and it would be skipped for good if a heal wrote the doc first. `POST /user/signup` arrives inside this window with nothing but sign-in residue on its doc, authenticates on it exactly as it did before the heal existed, and polls for the doc `auth:on-create` is about to write.
- **Anonymous accounts**, which get no user doc anywhere in the framework.
- **A uid with no Auth user**, which keeps the opposite direction refused (see [payment-system.md](payment-system.md#a-payment-never-creates-a-user-doc)).

A declined heal changes nothing about the request: the caller is answered on the doc they arrived with, which is the pre-heal lane byte for byte. Outside the window the write is a transaction and existing values win over schema defaults: there is one doc per uid and never a duplicate account, whichever of the two writers arrives second finds the doc and leaves it alone, and nothing already on the doc is edited. Reshaping existing docs stays the manual users migration's job alone.

## Read/Write Firestore

```javascript
const { admin } = Manager.libraries;

// Read
const doc = await admin.firestore().doc('users/abc123').get();
const data = doc.data();

// Write
await admin.firestore().doc('users/abc123').set({ field: 'value' }, { merge: true });
```

## Handle Errors

```javascript
// Send error response
ctx.report('Something went wrong', { code: 500, sentry: true });

// Or throw to reject
return reject(ctx.report('Bad request', { code: 400 }));
```

## Send Response

```javascript
// Success
ctx.respond({ success: true, data: result });

// With custom status
ctx.respond({ created: true }, { code: 201 });

// Redirect
ctx.respond('https://example.com', { code: 302 });
```
