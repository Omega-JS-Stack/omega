# Common Operations

Inside-the-handler patterns for the most frequent operations. See [docs/routes.md](routes.md) for the route file structure itself.

## Authenticate User

```javascript
const user = await ctx.authenticate();
if (!user.authenticated) {
  return ctx.report('Authentication required', { code: 401 });
}
```

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
