# WhatsApp Ordering — Status

Single source of truth for the Rasoi WhatsApp ordering pipeline. No secrets here.

## Target flow

YCloud → `app/api/webhooks/ycloud/whatsapp/route.ts` (HMAC verify) → `ycloud_event_inbox`
(unique insert) → enabled forwarder → n8n Rasoi Order Bridge (Header Auth `x-rasoi-whatsapp-secret`)
→ Rasoi `/api/ai/tools/*` and Supabase → YCloud reply.

## Verified state (2026-10-29)

| Area | State | Evidence |
|---|---|---|
| Webhook signature check, replay window, 503 on DB error | Done, unit-tested | `test/ycloud-webhook.test.mjs` 6/6 pass |
| Webhook route deployed | Yes, commit `4cb9db8` (2026-10-29). Live: signed synthetic event → 204, replay → 204, 1 inbox row; bad signature → 401; drain 401 without secret, `{"enabled":false}` with it | live checks, synthetic row deleted |
| `ycloud_event_inbox` migration | Applied 2026-10-29 (approved); RLS on, anon/authenticated denied | catalog query |
| PostgreSQL concurrency | Verified: 20 parallel retries → 1 row; 10 event ids for one message → 1 row; status events allowed | `RUN_DB_TESTS=1 node --test test/*.mjs` |
| Rasoi DB | Single environment (also used by Vercel); 22 menu items, 0 orders, 0 customers | read-only query |
| `orders_paused` | `false`; public endpoint returns `isOpen=true` | Production Supabase + `/api/settings/public` read-back (2026-10-29) |
| YCloud webhook endpoint | Active; subscribed to `whatsapp.inbound_message.received` only; signing secret matches `.env.local`. Keep status events excluded until the matching app deployment is live. | YCloud API read-back (2026-10-29) |
| Owner live message check | Passed: inbound event processed, Order Bridge succeeded, and owner received the paused-orders reply. Two status events caused 400s and false empty inbound rows; the subscription was removed and those rows deleted while inbox audit records were retained. | Supabase inbox/message read-back and n8n execution records (2026-10-29) |
| Code verification (2026-10-29) | Standard test suite: 11 passed, 1 opt-in DB test skipped; TypeScript check and production build passed. Targeted lint for the four core YCloud files passed. Whole-repo lint remains failing (212 errors, 98 warnings). | `node --test test/*.mjs`, `npx tsc --noEmit`, `npx next build`, targeted ESLint, `npm run lint` |
| Rasoi menu cleanup | Renamed `Pabbas Veg Sandwich` to `Veg Sandwich`; removed Pabbas wording from two descriptions; no Pabbas matches remain in `menu_items` or `restaurant_info` | Guarded Supabase transaction and post-update query (2026-10-29) |
| Superseded n8n workflows | `M5ATeom22h3ub9E1` and `JwgMPRAayOxGUZwu` archived and inactive | n8n API read-back (2026-10-29) |
| n8n webhook auth | Header Auth, credential `Rasoi \| WhatsApp Inbound Header Auth` (`dPHtUE9wSc0WyIpm`) | API PUT response |
| `RASOI_WHATSAPP_INBOUND_SECRET` | Set in `.env.local` and Vercel | Owner confirmation |
| Forwarder to n8n | Built and enabled in Vercel per owner confirmation; fast path via `after()` in the webhook, retries via `POST /api/internal/ycloud-inbox/drain` (header auth) | `test/ycloud-forwarder.test.mjs`; owner confirmed YCloud URL checked |
| Claim/lease SQL | `supabase/migrations/20261029_ycloud_event_claims.sql` applied 2026-10-29 (by owner); lease, fencing, backoff 30s×2ⁿ up to 1h, failed after 8, anon denied; 6 parallel claimers never share a row | rolled-back SQL check + `RUN_DB_TESTS=1` (12/12 pass) |
| Superseded AI bridge v1 | `Rasoi \| WhatsApp AI Bridge — DEV` (`JwgMPRAayOxGUZwu`), **archived and inactive**; kept as export/reference only | n8n API read-back (2026-10-29) |
| Pabbas parity workflows (7) | Typing Indicator, Order Bridge, Status Notifier, Agent Reply Sender, Staff AI Toggle, Blast Sender, Rating Request — all active | n8n API read-back after owner authorization (2026-10-29) |
| n8n drain scheduler | `Rasoi \| Inbox Drain — DEV` (`zQy094A473hNBkAw`), Rasoi folder, **active**, every minute → drain route with Header Auth; export `n8n/rasoi_inbox_drain_dev.json` | n8n API read-back (2026-10-29) |

## Conventions

- One Rasoi-only secret, `RASOI_WHATSAPP_INBOUND_SECRET`, header `x-rasoi-whatsapp-secret`,
  used both ways (Next.js → n8n and n8n → `/api/ai/tools/*`, see `lib/server/internal-auth.ts`).
- `RASOI_N8N_API_KEY` is for management scripts only; never in workflows or runtime requests.
  It currently has broad scopes (workflow delete/activate, credential delete) — replace with a
  narrower key.
- Pabbas exports in `n8n/live_pabbas_reference/` are reference only.

## Pending approvals / blockers

1. Orders are currently open in production per the live settings check. Before treating delivery fulfillment as ready, configure the public restaurant address, phone, and city and activate a rider. Verify status callbacks and run a controlled takeaway order before claiming the complete order-to-WhatsApp lifecycle is proven.

## Pabbas parity build (owner request: same workflows, Rasoi name)

`n8n/build_rasoi_workflows.py` converts the 7 live Pabbas workflows in `n8n/live_pabbas_reference/`
(Typing Indicator, Order Bridge, Status Notifier, Agent Reply Sender, Staff AI Toggle, Blast Sender,
Rating Request) into Rasoi versions: Rasoi URLs, Supabase host, WhatsApp number, header names and
credentials; webhook paths become `rasoi-*`; Groq transcription removed (OpenAI path only); Blast
webhook now requires `x-rasoi-whatsapp-secret` (dashboard sends it). It refuses to create any workflow
that still references Pabbas. Dry run output: `n8n/rasoi_build/`. The builder creates workflows inactive; the owner later authorized activation.

Created 2026-10-29 with no Pabbas references; all **active** after the owner's request, with read-back confirming all 7:
Typing Indicator `9MF4AL9PWNo55Tte`, Order Bridge `mR5qLGoAgFZmXajx`, Status Notifier `o5Z4RoWXKjiipzLV`,
Agent Reply Sender `945xE8ixGgeGGZQZ`, Staff AI Toggle `v6nMJs3qq8q5Mywn`, Blast Sender `y4GS5pPJlFAHwgbY`,
Rating Request `KmjniuLxGyj8p25P`. Credentials: `Rasoi Supabase (service key)` `DMaJVMEDKkVCsRcL`,
`Rasoi YCloud API Key` `uh9mDw6j89RNpyQb`. `inbound_bundle` migration applied (by owner).
`Rasoi | Inbox Drain — DEV` (`zQy094A473hNBkAw`) is also active. Superseded workflows, now archived and inactive:
`Rasoi | WhatsApp Inbound — DEV`, `Rasoi | WhatsApp AI Bridge — DEV`.

Go-live configuration (owner confirmed set and YCloud webhook URL checked):
- Vercel: `N8N_WHATSAPP_INBOUND_WEBHOOK_URL`, `N8N_STATUS_WEBHOOK_URL`, `N8N_ORDER_CREATED_WEBHOOK_URL`,
  `N8N_AGENT_REPLY_WEBHOOK_URL`, `N8N_AI_TOGGLE_WEBHOOK_URL`, `N8N_BLAST_WEBHOOK_URL` →
  `https://staff.brightmedia.tech/webhook/rasoi-{whatsapp-inbound,status,order-created,agent-reply,ai-toggle,blast}`.
- The Order Bridge is active and can send WhatsApp replies when an inbound event reaches it.

## Known issues

- Cart tool's server-written reply says "shall we place the order?" although WhatsApp checkout is not
  enabled yet.
- The toolHttpRequest node (v1.1) drops calls whose placeholder is a JSON array; use scalar placeholders.
- YCloud `whatsapp.message.updated` is still unsubscribed. The local Next.js handler now persists these events separately; enable the subscription only after that code is deployed.

## Current go-live gate (2026-10-29)

The owner confirmed readiness to accept real orders and supplied delivery pincodes `575028`, `575001`, and `575002`. Those pincodes are active in production. The production database migration `20261029_ycloud_status_and_atomic_orders.sql` is applied, including the atomic idempotent order RPC and outbound message status table. Live n8n workflows have corrected YCloud/Supabase credentials and the Order Bridge now supplies a stable idempotency key.

Production now returns `ordersPaused=false` and `isOpen=true`; Delivery, Takeaway, and Dine-in are enabled, and all three supplied pincodes are active. The paused reply should stop on fresh website/WhatsApp requests. No real WhatsApp order was created for this verification.

The requested dashboard account exists in Supabase Auth and `staff_members` with the active `admin` role. Password sign-in, the `staff_check` RPC, and the staff row policy passed. The owner later confirmed dashboard login works, and a logged-in production `/dashboard` view was visible during the 2026-10-29 audit. This supersedes the earlier unauthenticated 404 probe; do not treat that probe as the current dashboard state.

Delivery is enabled, but delivery fulfillment needs a rider and complete public restaurant details. The YCloud account has no approved WhatsApp template, so campaign sending is unavailable until one is approved.

## Feature audit (2026-10-29)

- The production admin dashboard rendered in an authenticated browser session. Source routes exist for orders, kitchen, POS, tables, menu, riders, live chat, contacts, blast campaigns, analytics, and settings. This confirms dashboard access and page availability; it is not a click-through test of every action.
- The public menu API returned 21 items, and the customer menu plus admin menu editor are implemented. The editor supports item details, categories, prices, availability, variants, images, pinning, and deletion. Admin-only menu writes are enforced by Supabase RLS.
- YCloud inbound messages are accepted by the signed webhook, persisted in the inbox, and forwarded to the active Rasoi n8n Order Bridge. The owner previously confirmed an inbound message reached the bridge and got a reply. After orders were unpaused, no new live WhatsApp message or real order was sent as part of this audit, so that fresh end-to-end path remains unverified.
- YCloud status callbacks are not subscribed, so message delivery/read status updates are not active. No approved WhatsApp templates are available, so campaign blasts cannot currently send.
- Delivery operations still need at least one active rider and public restaurant address, phone, and city. AI tool calls are configured but still require a live end-to-end verification.
- The Pabbas technical document describes its Stage A ordering demo and labels Meta WhatsApp integration and the AI conversational layer as future stages. Rasoi uses YCloud for its production WhatsApp path, so it is not a literal Meta implementation of that roadmap. The document does not define an admin-dashboard feature checklist.

Next production verification: enable YCloud message status events only after confirming the matching handler is deployed, inspect inbox-drain and n8n executions, then run the owner-authorized controlled takeaway order and confirm its customer reply and Status Notifier.

Verification of the current local code: `npx tsc --noEmit`, targeted ESLint, and `npx next build` pass. `node --test test/*.mjs` passes 14 tests; the opt-in DB test is skipped unless `RUN_DB_TESTS=1` is set. The opt-in integration suite passed separately against the production database with self-cleaning test rows. Whole-repo lint still has pre-existing failures.

## Next milestones

1. Inbound configuration, workflow activation, the paused-reply test, and dashboard access are confirmed. Orders are open. Fresh post-unpause WhatsApp ordering, status callbacks, and full delivery operations still need verification/setup.
2. Delivery to n8n is at-least-once. Inbound message uniqueness and atomic order idempotency are now enforced by the applied database migration and Order Bridge key. Outbound-message deduplication remains future work.
3. Rasoi inbound AI bridge. AI: owner chose to reuse the existing n8n credential
   `OpenAI account` (`qoyVBVk1ojHK9xi0`, also used by Pabbas) — usage and billing are shared; do not
   edit that credential. Tool routes `/api/ai/tools/*` require `x-rasoi-ai-secret` =
   `RASOI_AI_WEBHOOK_SECRET`, set in Vercel per the handover. Live requests remain to be verified. Tools are gated by `orders_paused`.
