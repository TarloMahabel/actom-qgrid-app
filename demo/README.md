# Demo build

Click-through copies of both apps, with no backend. The HTML, JS and CSS are byte-identical to
`apps/` — the only substitution is `vendor/supabase.js`, an in-memory stand-in exposing the same
client surface. Nothing leaves the browser.

## Run both

They are separate apps now, so serve them on separate ports:

```bash
(cd demo/applicant && python3 -m http.server 8080) &
(cd demo/admin     && python3 -m http.server 8081) &
```

- Applicant → `http://localhost:8080` — any email, any six digits as the code.
- Reviewer  → `http://localhost:8081` — the sign-in button logs you in as an admin reviewer.

Each app keeps its own copy of the mock, so state is per-origin, exactly as it will be in
production. Signing out of one does not sign you out of the other.

## Test ID numbers

All Luhn-valid, all fictitious.

| Number | Behaviour |
|---|---|
| `9803122081084` | Adult, female, SA citizen |
| `0111046042086` | Adult, male |
| `1007225013089` | **Under 18** — inserts the guardian step, blocks submission without guardian consent |
| `1234567890123` | Fails the checksum |

## Form setup

The console's **Form setup** tab seeds two intakes: one published (locked) and one draft. Open the
published one — everything is greyed out except the closing date. Clone it and the copy is fully
editable. A trade's **Subjects** grid sets which subjects it asks for, minimum marks and weights,
with a live preview. Publish, and watch it freeze.

## Worth demonstrating

1. The checksum-failing ID, to see the error state.
2. The under-18 ID — the progress marker grows from eight pylons to nine.
3. Leave both equity questions on "prefer not to say" and submit anyway.
4. Try to advance past documents without the ID upload.
5. Submit, then try to go back and edit.
6. Open a record in the console: unlock the ID with a one-word reason (rejected), then a real one,
   then check the access log.
7. Decline someone without typing notes.
8. Edit the published intake (refused), clone it, edit the clone.
9. Switch every subject off for a trade, then try to publish.

## What is faked

Encryption, uploads, signed-URL expiry, and RLS are all simulated in JavaScript. In production
those are database policies that hold even against a hostile client — which is the whole point,
and the one thing a demo cannot show. `db/test/run-tests.sh` is what proves it.

Do not deploy these folders.
