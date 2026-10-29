# WhatsApp Ordering — Status

Single source of truth for the Rasoi WhatsApp ordering pipeline. No secrets here.

## Target flow

YCloud → `app/api/webhooks/ycloud/whatsapp/route.ts` (HMAC verify) → `ycloud_event_inbox`
(unique insert) → forwarder (not built) → n8n `Rasoi | WhatsApp Inbound — DEV`
(Header Auth `x-rasoi-whatsapp-secret`) → Rasoi `/api/ai/tools/*` → YCloud reply.

## Verified state (2026-10-29)

| Area | State | Evidence |
|---|---|---|
| Webhook signature check, replay window, 503 on DB error | Done, unit-tested | `test/ycloud-webhook.test.mjs` 6/6 pass |
| Webhook route deployed | Yes, commit `4cb9db8` (2026-10-29). Live: signed synthetic event → 204, replay → 204, 1 inbox row; bad signature → 401; drain 401 without secret, `{"enabled":false}` with it | live checks, synthetic row deleted |
| `ycloud_event_inbox` migration | Applied 2026-10-29 (approved); RLS on, anon/authenticated denied | catalog query |
| PostgreSQL concurrency | Verified: 20 parallel retries → 1 row; 10 event ids for one message → 1 row; status events allowed | `RUN_DB_TESTS=1 node --test test/*.mjs` |
| Rasoi DB | Single environment (also used by Vercel); 22 menu items, 0 orders, 0 customers | read-only query |
| `orders_paused` | `true` | `settings` table |
| n8n workflow `M5ATeom22h3ub9E1` | Exists, inactive, Rasoi folder, matches local JSON | API read-back |
| n8n webhook auth | Header Auth, credential `Rasoi \| WhatsApp Inbound Header Auth` (`dPHtUE9wSc0WyIpm`) | API PUT response |
| `RASOI_WHATSAPP_INBOUND_SECRET` | Set in `.env.local` (not yet in Vercel) | name check only |
| Forwarder to n8n | Built, **off** by default (`RASOI_WHATSAPP_FORWARDING_ENABLED=true` + `N8N_WHATSAPP_INBOUND_WEBHOOK_URL` enable it). `lib/server/ycloud-forwarder.ts`, fast path via `after()` in the webhook, retries via `POST /api/internal/ycloud-inbox/drain` (header auth) | `test/ycloud-forwarder.test.mjs` |
| Claim/lease SQL | `supabase/migrations/20261029_ycloud_event_claims.sql` applied 2026-10-29 (by owner); lease, fencing, backoff 30s×2ⁿ up to 1h, failed after 8, anon denied; 6 parallel claimers never share a row | rolled-back SQL check + `RUN_DB_TESTS=1` (12/12 pass) |
| n8n AI bridge v1 | `Rasoi \| WhatsApp AI Bridge — DEV` (`JwgMPRAayOxGUZwu`), **inactive**, export `n8n/rasoi_whatsapp_ai_bridge_dev.json`. Webhook (inbound Header Auth) → text-only extract → gpt-4o-mini agent with Menu, Business Info, Cart tools (`Rasoi \| AI Tools Header Auth`, `EnkoukP9izBJ267l`) → reply built but **not sent**. Cart phone is bound from the verified event, placed last so AI input cannot override it. No order/status/checkout tools yet. Owner confirmed folder placement | Live test 2026-10-29 (temporarily activated, synthetic phone, carts deleted): menu answer used real prices; add-to-cart priced server-side (2 × ₹105 = ₹210); prompt-injection refused with no tool call; wrong secret → 403 |
| n8n drain scheduler | `Rasoi \| Inbox Drain — DEV` (`zQy094A473hNBkAw`), Rasoi folder, **inactive**, every minute → drain route with Header Auth; export `n8n/rasoi_inbox_drain_dev.json` | API create response |

## Conventions

- One Rasoi-only secret, `RASOI_WHATSAPP_INBOUND_SECRET`, header `x-rasoi-whatsapp-secret`,
  used both ways (Next.js → n8n and n8n → `/api/ai/tools/*`, see `lib/server/internal-auth.ts`).
- `RASOI_N8N_API_KEY` is for management scripts only; never in workflows or runtime requests.
  It currently has broad scopes (workflow delete/activate, credential delete) — replace with a
  narrower key.
- Pabbas exports in `n8n/live_pabbas_reference/` are reference only.

## Pending approvals / blockers

1. Add `RASOI_WHATSAPP_INBOUND_SECRET` to Vercel env (same value as `.env.local`) before deploying.

## Pabbas parity build (owner request: same workflows, Rasoi name)

`n8n/build_rasoi_workflows.py` converts the 7 live Pabbas workflows in `n8n/live_pabbas_reference/`
(Typing Indicator, Order Bridge, Status Notifier, Agent Reply Sender, Staff AI Toggle, Blast Sender,
Rating Request) into Rasoi versions: Rasoi URLs, Supabase host, WhatsApp number, header names and
credentials; webhook paths become `rasoi-*`; Groq transcription removed (OpenAI path only); Blast
webhook now requires `x-rasoi-whatsapp-secret` (dashboard sends it). It refuses to create any workflow
that still references Pabbas. Dry run output: `n8n/rasoi_build/`. Created workflows are inactive.

Blockers:
- n8n credentials `Rasoi Supabase (service key)` (Custom Auth: `apikey` + `Authorization: Bearer`)
  and `Rasoi YCloud API Key` (Header Auth `X-API-Key`) must exist; their ids go in
  `n8n/rasoi_credential_ids.json`.
- `supabase/migrations/20261029_inbound_bundle.sql` (port of Pabbas phase 12) must be applied.
- Vercel: `N8N_WHATSAPP_INBOUND_WEBHOOK_URL`, `N8N_STATUS_WEBHOOK_URL`, `N8N_ORDER_CREATED_WEBHOOK_URL`,
  `N8N_AGENT_REPLY_WEBHOOK_URL`, `N8N_AI_TOGGLE_WEBHOOK_URL`, `N8N_BLAST_WEBHOOK_URL` →
  `https://staff.brightmedia.tech/webhook/rasoi-{whatsapp-inbound,status,order-created,agent-reply,ai-toggle,blast}`.
- The Order Bridge sends real WhatsApp replies once active (same as Pabbas).

## Known issues

- Rasoi menu data still contains Pabbas wording (e.g. "Pabbas Veg Sandwich") from the data import.
- Cart tool's server-written reply says "shall we place the order?" although WhatsApp checkout is not
  enabled yet.
- The toolHttpRequest node (v1.1) drops calls whose placeholder is a JSON array; use scalar placeholders.

## Next milestones

1. When the AI bridge is ready: activate the drain scheduler and set
   `N8N_WHATSAPP_INBOUND_WEBHOOK_URL` + `RASOI_WHATSAPP_FORWARDING_ENABLED=true` in Vercel.
2. Delivery to n8n is at-least-once. Every side effect n8n triggers must carry the event id as an
   idempotency key enforced by Rasoi (e.g. `create_customer_order(p_idempotency_key)`), plus an
   outbound-message dedupe table before replies are sent.
3. Rasoi inbound AI bridge. AI: owner chose to reuse the existing n8n credential
   `OpenAI account` (`qoyVBVk1ojHK9xi0`, also used by Pabbas) — usage and billing are shared; do not
   edit that credential. Tool routes `/api/ai/tools/*` require `x-rasoi-ai-secret` =
   `RASOI_AI_WEBHOOK_SECRET`, which is unset (all tools return 401 until it is configured). using `/api/ai/tools/*`, gated by `orders_paused`.
