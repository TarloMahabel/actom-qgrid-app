# Deploying to Vercel

The security headers live in `apps/applicant/vercel.json` and
`apps/admin/vercel.json`. **Vercel does not read `netlify.toml`** — without
these files both apps deploy with no Content-Security-Policy, no HSTS and no
frame protection at all.

JSON has no comment syntax and Vercel's schema rejects unknown properties, so
the reasoning that used to sit in `netlify.toml` is here instead.

---

## Two projects, not one

Create a **separate Vercel project per app**, both pointing at this repository.

| | Applicant portal | Reviewer console |
|---|---|---|
| Root Directory | `apps/applicant` | `apps/admin` |
| Framework Preset | Other | Other |
| Build Command | *(empty)* | *(empty)* |
| Output Directory | *(empty)* | *(empty)* |
| Suggested domain | `apply.actom.co.za` | `recruit.actomtools.co.za` |

Root Directory is a dashboard setting and cannot be set from `vercel.json`.

**Do not serve the console on a subpath of the applicant site.** Same origin
means shared `localStorage` and shared session storage, so a single XSS in the
public form would reach a signed-in reviewer's session. Different origins are
the reason that is impossible.

---

## Access control

Separating the front-ends does **not** separate the backend. Both apps use the
same Supabase project and the same public anon key. The real data boundary is
RLS plus the column grants in `db/schema.sql`, and it holds regardless of how
the sites are hosted.

What the separation buys, and how to make it count:

1. **Entra Conditional Access** on the console's app registration. This is the
   strong control: require a compliant, ACTOM-managed device and, if practical,
   a trusted network location. An attacker with a stolen reviewer password still
   cannot reach applicant data. **Still outstanding.**

2. **Vercel Deployment Protection** on the console project
   (Settings → Deployment Protection), so it is not reachable by an anonymous
   visitor at all. This replaces what Netlify password protection did. Defence
   in depth only — never the sole control.

3. **Separate domain**, so the console is not discoverable from the public site.

---

## Why the two CSPs differ

The applicant app signs in with **email OTP only**, so
`login.microsoftonline.com` is deliberately **absent** from its `connect-src`.
An injected script cannot start an Entra flow there.

The console signs in with **Entra**, so that origin is allowed there and nowhere
else.

Neither app allows external font origins: both use system fonts. The Google
Fonts entries carried over from the Netlify config were removed, since a policy
permitting things the app does not use is only extra surface.

The applicant app has `manifest-src 'self'` because it ships a web manifest; the
console has none, so the directive is omitted rather than added speculatively.

---

## If the Supabase project ref changes

Update `connect-src` in **both** files. Miss it and the app loads normally but
silently cannot reach its own backend — sign-in appears to hang with nothing in
the console except a CSP violation.

---

## Verify after every deploy

A header config that has not been checked against the live response is only a
hope. From Git Bash:

```bash
bash verify-headers.sh https://<applicant-url>
bash verify-headers.sh https://<console-url> admin
```

The script fails loudly on anything missing, and warns if the console answers
`200` to an anonymous request — which is how you find out Deployment Protection
is not on yet.

Netlify sets its own `Strict-Transport-Security` and `Cache-Control` defaults, as
does Vercel. Those appearing in a response does **not** mean your config was
read; the script checks the values, not just the presence, for exactly that
reason.
