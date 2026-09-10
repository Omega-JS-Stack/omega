# The page paint contract

What every page owes a visitor in its first frame, and what it may make them
wait for. Ratified by Ian on 2026-08-27
([#637](https://github.com/Omega-JS-Stack/omega/issues/637)) after the checkout
page held its prices behind a cold backend.

The rules are five. They apply to every page in `packages/web/core/js/pages/`
and to every consumer page built on this framework.

## 1. Static content paints immediately

A page never hides its DOM waiting for auth. Everything the build already knows
goes on screen in the first frame: copy, prices from the payment config, plan
tiles, buttons, forms.

Redirects are not the page's job. The global auth policy owns them
(`packages/web/core/js/core/auth.js`): a visitor in the wrong state is sent
elsewhere before the page code runs. A page that hides itself "in case" is
hiding from a visitor who is allowed to be there.

That listener also owns the MID-SESSION case: it redirects the moment
@omega.js/client's session probe signs a dead session out, so a revoked,
disabled or deleted account leaves an `authenticated` page for sign-in with no
reload ([the session probe](../client/index.md#the-session-probe-omegaauthprobesession),
[#798](https://github.com/Omega-JS-Stack/omega/issues/798)).

## 2. User data arrives through bindings

Anything that depends on the signed-in user renders through
`data-omega-bind`, with a skeleton on the element until it fills. The client
fills the `auth`, `usage`, `config` and `device` roots on every page when auth
settles (`packages/client/src/modules/auth.js`). Page code does not repeat that
work.

Page code awaits auth for exactly one reason: to make a request that needs the
user. Never to decide whether to draw something.

## 3. An answer the visitor acts on resolves ONCE

Trial eligibility, the current plan, the price actually being charged: the
visitor decides with these, so they must never flip from one answer to another
while being read.

The spot holding such an answer keeps its skeleton until the answer lands, and
then renders once. The rest of the page is already painted around it. Only the
spot waits.

The bindings root key is the unit of deferral. `bindings.update()` filters by
the top-level keys it was handed, so a spot that must wait belongs to a root
the early paint does not publish
([packages/client/docs/bindings.md](../../packages/client/docs/bindings.md)).
Checkout is the worked example: its build-config half publishes `checkout`, and
the money line and trial spot live under `order`, written once when eligibility
answers.

## 4. Every wait has a deadline and a named fallback

A network wait behind user-visible copy gets a timeout, a constant that names
it, and a fallback state that is a decision rather than an accident. The
fallback is logged as a warning when it fires.

Pick the fallback that keeps the page's promises.

Checkout's trial check has THREE answers, not two: yes, no, and unknown. A
check that timed out or failed is unknown, and the page splits that answer in
two (Ian 2026-08-27). What it SHOWS stays conservative: no trial quoted, the
full amount due today, because rule 3 never shows a price the server has not
confirmed. What it ASKS FOR in the intent payload is the trial anyway, because
the intent route re-checks eligibility against the buyer's own order history and
silently downgrades anyone who does not qualify. Asking costs a non-qualifying
buyer nothing; not asking would cost a qualifying one their offer over a slow
network. A visitor is never quoted a price they are not charged, and never
loses an offer to a timeout.

## 5. Forms gate their submit control

Every form uses FormManager
(`@omega.js/client/modules/form-manager.js`). When a form must not be submitted
until an async answer is in, the page registers a gate per answer before it
calls `ready()`:

```javascript
formManager.addGate('eligibility');
formManager.addGate('recaptcha');
formManager.ready();          // held: the form stays `initializing`
...
formManager.resolveGate('recaptcha');
formManager.resolveGate('eligibility');   // the last one arms the form
```

The submit controls stay disabled while a gate is open. The rest of the form
stays live, so the visitor can still read it and change their choices. Both
calls fail loudly on a mistake: a gate added after the form armed throws, and so
does resolving a name that opened no gate (a typo would otherwise leave the form
gated forever).

## Reading a page against the contract

Four questions, in order:

1. Does anything in the first frame wait on a promise? If yes, does it need the
   user, or was the answer already in the build config?
2. Is any element hidden pending auth that the auth policy already protects?
3. Can any user-visible value be written twice with two different answers?
4. Does every wait behind visible copy have a deadline and a named fallback?

## Related

- [docs/web/index.md](index.md) — the web framework guide
- [docs/client/index.md](../client/index.md) — the runtime that fills the bindings
- [packages/client/docs/bindings.md](../../packages/client/docs/bindings.md) — `data-omega-bind`, skeletons, root-key update filtering
