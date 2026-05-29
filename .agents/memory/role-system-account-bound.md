---
name: Web/mobile role system is already account-bound
description: Why "remove the demo role switcher for production" is largely a no-op for regular users
---

The AutoCare role switch is localStorage-backed (`lib/role.ts`, `autocare_role`), but for any non-super_admin user the auth layer clamps the local role to the authenticated account role on load (`artifacts/autocare/src/lib/auth.tsx` `effectiveRoleFor` + a resync effect; mobile mirrors this via `lib/roles.ts`). Only `super_admin` can freely switch (impersonation, surfaced in `AppShell`). The backend enforces real permissions regardless of the previewed role.

**Why:** A production request to "remove the role switcher / derive role from account" is mostly already satisfied — regular users cannot escape their account role. The genuine production cleanup is removing *demo login shortcuts* and any standalone page that lets a user call `setRole` directly (a former `pages/Settings.tsx` "Demo Mode: Role Switcher" did this and was removed). Keep super-admin impersonation; it is a legitimate support tool.

**How to apply:** Before proposing a large "role from account" refactor for production, check `auth.tsx` clamping first. Treat impersonation (super_admin-only) as a feature, not demo cruft.
