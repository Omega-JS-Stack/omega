# Code Patterns

## Short-Circuit Returns

Use early returns instead of nested conditionals:

```javascript
// CORRECT
function handler(data) {
  if (!data) {
    return ctx.report('Missing data', { code: 400 });
  }

  // Main logic here
  return ctx.respond({ success: true });
}

// INCORRECT
function handler(data) {
  if (data) {
    // Main logic here
    return ctx.respond({ success: true });
  }
}
```

## Logical Operators on New Lines

Place operators at the start of continuation lines:

```javascript
// CORRECT
const isValid = hasPermission
  || isAdmin
  || isOwner;

// INCORRECT
const isValid = hasPermission ||
  isAdmin ||
  isOwner;
```

## Firestore Document Access

Use shorthand `.doc()` path:

```javascript
// CORRECT
admin.firestore().doc('users/abc123')

// INCORRECT
admin.firestore().collection('users').doc('abc123')
```

## Template Strings for Requires

```javascript
// CORRECT
require(`${functionsDir}/node_modules/@omega.js/backend`)

// INCORRECT
require(functionsDir + '/node_modules/@omega.js/backend')
```

## Prefer fs-jetpack

Use `fs-jetpack` over `fs` or `fs-extra` for file operations.

## Coded errors: 400 = permanent config fault

An error carrying `code: 400` means a brand-config hole (or an equally permanent
caller fault) — something a retry can never heal. The full statement of the
convention and every place it is caught lives in
[marketing-campaigns.md](marketing-campaigns.md) § Claim/Lease Lifecycle; new
config-hole throws follow it (`errorWithCode(..., 400)` in the email library,
`err.code = 400` elsewhere) rather than throwing a code-less Error, which
`respond()` reports as a Sentry-captured 500.
