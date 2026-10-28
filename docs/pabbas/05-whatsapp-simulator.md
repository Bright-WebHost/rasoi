# 5. WhatsApp Simulator

The WhatsApp Simulator (`app/dev/whatsapp/page.tsx`) is a vital development and
CEO-demo tool used to demonstrate and test the "WhatsApp-first" flow without
requiring a live Meta Developer account, approved phone numbers, or paid templates.

## Why It Exists

Testing a real WhatsApp flow requires ngrok tunnels, live webhooks, and strict
adherence to Meta's 24-hour session rules. The simulator allows rapid iteration
of the core Pabbas AI logic by mocking the interaction locally and on Vercel.

---

## Access Control

The simulator is **protected** — it is not publicly accessible without
authentication. This is intentional:

- The simulator creates real database records (`app_customers`, `ordering_sessions`).
- The `/api/dev/whatsapp/*` routes have access to the Supabase admin client.
- The `/api/dev/whatsapp/messages` endpoint queries the `dev_whatsapp_messages` table.
- These must not be exposed to the public internet without a gate.

Protection is implemented via an **HTTP-only `pabbas_dev_access` cookie** that
is issued only after verifying the `DEV_ACCESS_KEY` server-side.

> This cookie is entirely separate from `pabbas_session` (customer identity).
> It does NOT identify any customer. It only unlocks developer tooling.

---

## Local Development Access

On `localhost`, the cookie gate is **disabled entirely** — `NODE_ENV !== 'production'`
causes `verifyDevAccessFromCookies()` to return `true` unconditionally.

```
http://localhost:3000/dev/whatsapp     → works immediately, no login needed
http://192.168.x.x:3000/dev/whatsapp  → works on LAN/mobile testing
```

---

## Vercel (Production) Access

On Vercel, `/dev/*` routes are blocked by the Edge Middleware (`proxy.ts`) unless
a valid `pabbas_dev_access` cookie exists.

### Step-by-step

1. Navigate to: `https://pabbas-one.vercel.app/dev/login`
2. Enter the `DEV_ACCESS_KEY` value (shared with the dev team, never committed).
3. Click **Continue**.
4. On success, you are redirected to `/dev/whatsapp` and a session cookie is set
   (HTTP-only, Secure, SameSite=Lax, 8-hour expiry).
5. The simulator works normally for 8 hours.

### Logout

To revoke access:
```
POST https://pabbas-one.vercel.app/api/dev/logout
```
Or use a curl / fetch call. After logout, `/dev/whatsapp` redirects back to
`/dev/login`.

---

## DEV_ACCESS_KEY Setup

### Generate a strong key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### Vercel

1. Go to Vercel Dashboard → Project → Settings → Environment Variables.
2. Add: `DEV_ACCESS_KEY = <your-generated-key>`
3. Environment: **Production** (and Preview if needed).
4. Redeploy or redeploy via a new push.

### Local `.env.local`

```dotenv
# Locally, the cookie gate is bypassed entirely. Any value works.
DEV_ACCESS_KEY=<your DEV_ACCESS_KEY from .env.local>
```

**Never commit the production key. Never put it in logs, URLs, or client bundles.**

---

## Security Boundary

| Concern | How it is handled |
|---|---|
| Secret in client bundle | ❌ Never. `DEV_ACCESS_KEY` is server-only. |
| Secret in URL / query param | ❌ Never. The `/dev/login` form POSTs JSON over HTTPS. |
| Secret in React state | ❌ The input value is read from the DOM ref immediately on submit, then the field is cleared. |
| Secret in logs | ❌ Never logged. |
| Cookie readable by JS | ❌ Cookie is `HttpOnly`. |
| Cookie over HTTP | ❌ Cookie has `Secure` flag in production. |
| Timing attack on comparison | ✅ `timingSafeEqual` used in both middleware and API routes. |
| Cookie forgery | ✅ Cookie value is an HMAC-SHA256 signed nonce, not the raw key. |
| Simulator as customer identity | ❌ `pabbas_dev_access` cookie has no role in order creation or customer auth. |

---

## Distinction from Customer WhatsApp Authentication

| | Dev Access Cookie | Customer Session Cookie |
|---|---|---|
| Name | `pabbas_dev_access` | `pabbas_session` |
| Purpose | Unlock dev tooling | Identify authenticated customer |
| Set by | `POST /api/dev/access` | `GET /auth/whatsapp` |
| Cleared by | `POST /api/dev/logout` | Cookie expiry |
| Used in | `proxy.ts`, `/api/dev/*` | `/api/orders`, `/api/session/me` |
| Guards | Simulator access | Order placement, session state |
| Expiry | 8 hours | 2 hours |

---

## How the Simulator Works

### 1. Simulated Customer Selection

The UI lets the developer act as "Customer A" or "Customer B". These are seeded
into `app_customers` with fixed `channel_user_id` values (`dev_customer_a`, `dev_customer_b`).

### 2. Session Creation

When a customer is selected, the simulator calls `POST /api/dev/whatsapp/session`.
This endpoint:
- Upserts the dev customer into `app_customers`.
- Generates a cryptographically secure token, hashes it, and stores it in `ordering_sessions`.
- Returns the raw token as a relative URL: `/auth/whatsapp?token=...`

### 3. AI Chat

Every message sent in the simulator UI calls `POST /api/dev/whatsapp/ai`, which:
- Resolves customer identity from the session cookie (production path) or
  from `channelUserId` in the body (dev fallback, gated by `pabbas_dev_access`).
- Forwards the message to the n8n AI webhook (`N8N_AI_WEBHOOK_URL`) with an HMAC secret.
- Returns the AI reply to the simulator UI.

### 4. View Menu & Order CTA

Every AI reply includes a **"View Menu & Order"** button. Clicking it opens the
ordering page in a new tab using the one-time session URL.

### 5. Mobile / LAN Support

Session URLs are relative so they resolve correctly on mobile browsers connected
via LAN IP (e.g., `http://192.168.x.x:3000`).

### 6. Notification Polling

After an order is placed, n8n inserts a confirmation message into
`dev_whatsapp_messages`. The simulator polls `GET /api/dev/whatsapp/messages`
every 3 seconds and displays new messages in the chat UI.
