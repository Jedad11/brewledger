# Phone OTP — SMS provider setup

WBS 4.1 — Phone OTP Authentication, manual step. Records which SMS vendor
Owner Console phone-OTP login actually runs on, why, and what still needs
periodic attention during the pilot.

## Vendor selection

**Vonage** (Communications APIs, formerly Nexmo), account `Master (fcf6627b)`.

Two other vendors were tried first and rejected:

| Vendor | Outcome |
|---|---|
| Twilio | Demanded card/credit-card binding before a number could be purchased — violates the project's no-card-wall rule (same reasoning as `docs/adr/001-infrastructure-choice.md`'s GCP rejection). Abandoned before any credential was generated. |
| MessageBird | Dashboard/login was unreachable at signup time. Abandoned in favour of Vonage rather than waiting it out. |
| **Vonage** | Signup and trial credit ($2.00 as of 2026-08-19) required no card. **Selected.** |

Credentials (API Key + API Secret) are stored only in **Supabase Dashboard →
Authentication → Providers → Phone**, project `brewledger-dev`
(`xeoaoabqmqutnsssneiq`). Not committed to this repo or to `supabase/config.toml`
(which only holds the SMS template and provider toggle, no secret values).

## Known behaviour — sender ID falls back to "NXSMS"

Requests to send from a custom alphanumeric sender (e.g. `BrewLedger`) to Thai
numbers are silently overridden by Vonage to its shared default sender
**"NXSMS"**. This is expected: Thai carriers require sender IDs to be
pre-registered (an NBTC-adjacent process similar in weight to the licensed
payment gateway KYC this project already avoided elsewhere), and an
unregistered custom sender gets swapped rather than rejected. The OTP still
delivers correctly — only the visible "from" name is generic. Not treated as
a defect; registering a branded sender ID is out of scope for the pilot.

Because the sender name can't carry the brand, the message *body* does. SMS
template (set in **Supabase Dashboard → Authentication → Templates → SMS
Message**, mirrored in `supabase/config.toml`'s `[auth.sms].template`):

```
BrewLedger code: {{ .Code }}. Expires in 10 min. Do not share.
```

Kept in English and under ~70 GSM-7 characters deliberately — Thai text uses
UCS-2 encoding, which caps a single SMS segment at ~70 characters instead of
160 and doubles send cost per OTP once exceeded. This is the OTP a merchant
receives for their own login, not customer-facing copy, so the project's
"all copy in Thai" rule was not applied here.

## Verification

End-to-end path (Supabase Auth → Vonage → real Thai handset) tested live via:

```bash
curl -X POST 'https://xeoaoabqmqutnsssneiq.supabase.co/auth/v1/otp' \
  -H "apikey: <anon-key>" -H "Content-Type: application/json" \
  -d '{"phone": "+66937404956"}'
```

First attempt returned `422 sms_send_failed` ("Bad Credentials") — the API
Secret pasted into the Supabase provider form did not match Vonage's. Re-
copied from Vonage's API Settings page and re-saved; retry returned `200 {}`
and the SMS arrived on the real handset within the expected window.
**Confirmed working 2026-08-19.**

## Outstanding — do before treating WBS 4.1's manual step as fully closed

- [x] **Authentication → Providers → Email** — "Enable Email provider"
      disabled. BrewLedger auth is phone-only.
- [x] **Authentication → Rate Limits → SMS messages** — set to `5`/hour in
      the Dashboard, matching `supabase/config.toml`'s
      `[auth.rate_limit].sms_sent`.
      This is a project-wide hourly cap, not per phone number — Supabase's
      Dashboard rate limit has no per-number granularity. The per-phone /
      per-IP throttle described in WBS 4.1's acceptance criteria (5 sends
      per phone per hour, 20 per IP per hour) is a separate `auth_attempts`
      table the `engineer` leg still needs to build in code — not covered
      by this Dashboard setting.
- [x] **OTP expiry** confirmed at 600 seconds (10 minutes) on the Phone
      provider config — matches the "Expires in 10 min" wording baked into
      the SMS template above.

**WBS 4.1 manual step: closed 2026-08-19.**

## Application-side rate limiting (code, not the Dashboard cap)

WBS 4.1's own acceptance criteria (5 sends/phone/hour, 20 sends/IP/hour) are
separate from the Dashboard's project-wide `sms_sent = 5`/hour cap above —
that cap has no per-number or per-IP granularity. Both are enforced in
`supabase/functions/console-auth-request-otp`, backed by an `auth_attempts`
table (`phone_hash`, `ip_hash`, HMAC-SHA256-hashed, zero RLS policies —
service_role only).

An earlier draft of this entry tried to host the phone-side check inside a
custom Supabase Auth **Send SMS Hook** (`auth-send-sms-hook`, routing actual
delivery through a different, never-provisioned vendor, Thaibulksms) instead
of the Vonage native-provider integration verified above. That draft was
removed: it was never wired to real credentials, and it would have silently
overridden the working Vonage provider path had it ever been enabled against
a live project. Delivery is Supabase Auth's native phone provider (Vonage)
end to end; `console-auth-request-otp` only gates and forwards to
`signInWithOtp`, it does not send SMS itself.

### Required secret: `AUTH_ATTEMPTS_HASH_SALT`

`console-auth-request-otp` refuses to run without it (see
`_shared/auth/rateLimit.ts`). Set it with:

```bash
supabase secrets set AUTH_ATTEMPTS_HASH_SALT=<random value> --project-ref xeoaoabqmqutnsssneiq
```

Locally, copy `supabase/functions/.env.example` to `supabase/functions/.env`
(gitignored) with any value before `supabase functions serve`.

## Pilot risk to monitor

Vonage trial credit was **$2.00 on 2026-08-19**, at roughly **$0.03/SMS** to
a Thai number (checked against Vonage's own Logs page — an earlier estimate
of $0.30/SMS in this doc was wrong by 10x and has been corrected) — about
**66 sends total** before the trial credit is exhausted. OTP is the only
feature that uses SMS in this product (confirmed against the WBS dictionary
— no other entry sends an SMS or a one-time code; customer-facing order
lookup uses phone number as a plain lookup key, never OTP-verified). Volume
is therefore low (one send per merchant login, not per order), but the
credit is still finite — check the balance before the pilot goes live with
real merchants and top up or move off trial pricing if it's close to zero.
