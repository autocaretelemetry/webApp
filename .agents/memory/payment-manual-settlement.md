---
name: Payment manual settlement actions
description: Operational rule for super-admin actions that terminally settle a payment row.
---

# Operator settlement actions must reuse the settlement dispatcher

When a super-admin manually settles a stuck payment from the back-office queue
(e.g. "give up on this charge"), drive it through the same settlement dispatcher
the browser callback / webhook / reconciler use — by handing it a synthetic
terminal verification result — instead of mutating the payment row directly.

**Why:** the dispatcher's already-settled guard plus the compare-and-swap that
only flips a still-`pending` row are the *only* things stopping a manual action
from racing (and clobbering) a real settlement arriving concurrently from the
provider. Bypassing it reintroduces a lost-update bug under concurrency.

**How to apply:** keep the failure-handler flip CAS-guarded and gate its side
effects (e.g. subscription cancellation) on the CAS win. Store operator audit
notes on the existing reason text behind a marker prefix rather than adding a
column. These payment-queue mutation routes are **super_admin-only**, not
admin — assert that in tests (a plain admin must get 403).
