# Key Patterns

## 1. Early Return (Short-Circuit)

Always use early returns instead of nested conditionals:

```javascript
// CORRECT
function doSomething() {
  if (!condition) {
    return;
  }
  // Long code block...
}

// WRONG
function doSomething() {
  if (condition) {
    // Long code block...
  }
}
```

## 2. DOM Element Naming

Prefix DOM element variables with `$`:

```javascript
const $button = document.querySelector('.submit-btn');
const $input = document.getElementById('email');
```

## 3. Logical Operator Formatting

Place operators at the START of continuation lines:

```javascript
// CORRECT
const result = conditionA
  || conditionB
  || conditionC;

// WRONG
const result = conditionA ||
  conditionB ||
  conditionC;
```

## 4. Firestore Path Syntax

Prefer path syntax over collection/doc chaining:

```javascript
// PREFERRED
db.doc('users/userId')

// ALSO SUPPORTED
db.doc('users', 'userId')
```

## 5. Dynamic Imports

Firebase modules are dynamically imported to reduce bundle size:

```javascript
const { initializeApp } = await import('firebase/app');
const { getAuth } = await import('firebase/auth');
```

## 6. Configuration Deep Merge

User config is deep-merged with defaults in `_processConfiguration()`. Only override what you need:

```javascript
// Defaults defined in _processConfiguration()
const defaults = {
  environment: 'production',
  firebase: { app: { enabled: true, config: {} } },
  // ...
};
```

## 7. Click Triggers

Click-driven UI never hand-rolls a listener: it registers on the shared trigger
registry (`modules/triggers.js`), which owns the ONE delegated `document` click
listener. The class is always `omega-<name>` — callers never spell it:

```javascript
import { registerTrigger } from '@omega.js/client/modules/triggers.js';

// A click on `.omega-signout` (or anything inside one) runs this
registerTrigger('signout', async (event, element) => {
  // Handle signout
});
```
