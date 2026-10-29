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
| Webhook route deployed | No — changes are uncommitted | `git status` |
| `ycloud_event_inbox` migration | Applied 2026-10-29 (approved); RLS on, anon/authenticated denied | catalog query |
| PostgreSQL concurrency | Verified: 20 parallel retries → 1 row; 10 event ids for one message → 1 row; status events allowed | `RUN_DB_TESTS=1 node --test test/*.mjs` |
| Rasoi DB | Single environment (also used by Vercel); 22 menu items, 0 orders, 0 customers | read-only query |
| `orders_paused` | `true` | `settings` table |
| n8n workflow `M5ATeom22h3ub9E1` | Exists, inactive, Rasoi folder, matches local JSON | API read-back |
| n8n webhook auth | Header Auth, credential `Rasoi \| WhatsApp Inbound Header Auth` (`dPHtUE9wSc0WyIpm`) | API PUT response |
| `RASOI_WHATSAPP_INBOUND_SECRET` | Set in `.env.local` (not yet in Vercel) | name check only |
| Forwarder to n8n | Built, **off** by default (`RASOI_WHATSAPP_FORWARDING_ENABLED=true` + `N8N_WHATSAPP_INBOUND_WEBHOOK_URL` enable it). `lib/server/ycloud-forwarder.ts`, fast path via `after()` in the webhook, retries via `POST /api/internal/ycloud-inbox/drain` (header auth) | `test/ycloud-forwarder.test.mjs` |
| Claim/lease SQL | `supabase/migrations/20261029_ycloud_event_claims.sql` applied 2026-10-29 (by owner); lease, fencing, backoff 30s×2ⁿ up to 1h, failed after 8, anon denied; 6 parallel claimers never share a row | rolled-back SQL check + `RUN_DB_TESTS=1` (12/12 pass) |
| n8n drain scheduler | `Rasoi \| Inbox Drain — DEV` (`zQy094A473hNBkAw`), Rasoi folder, **inactive**, every minute → drain route with Header Auth; export `n8n/rasoi_inbox_drain_dev.json` | API create response |
| Deployed webhook | Old committed Pabbas-era route (needs `PABBAS_WHATSAPP_INBOUND_SECRET`, else 500) | `git show HEAD` |

## Conventions

- One Rasoi-only secret, `RASOI_WHATSAPP_INBOUND_SECRET`, header `x-rasoi-whatsapp-secret`,
  used both ways (Next.js → n8n and n8n → `/api/ai/tools/*`, see `lib/server/internal-auth.ts`).
- `RASOI_N8N_API_KEY` is for management scripts only; never in workflows or runtime requests.
  It currently has broad scopes (workflow delete/activate, credential delete) — replace with a
  narrower key.
- Pabbas exports in `n8n/live_pabbas_reference/` are reference only.

## Pending approvals / blockers

1. Add `RASOI_WHATSAPP_INBOUND_SECRET` to Vercel env (same value as `.env.local`) before deploying.

## Next milestones

1. Commit + deploy (owner approval), then activate the drain scheduler and set
   `N8N_WHATSAPP_INBOUND_WEBHOOK_URL` + `RASOI_WHATSAPP_FORWARDING_ENABLED=true` in Vercel.
2. Delivery to n8n is at-least-once. Every side effect n8n triggers must carry the event id as an
   idempotency key enforced by Rasoi (e.g. `create_customer_order(p_idempotency_key)`), plus an
   outbound-message dedupe table before replies are sent.
3. Rasoi inbound AI bridge — needs a Rasoi-owned AI provider credential in n8n (none exists yet) using `/api/ai/tools/*`, gated by `orders_paused`.
