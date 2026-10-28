# 17. Testing & Verification

The following scenarios have been rigorously tested and verified in the current architecture. When modifying the codebase, ensure these tests continue to pass.

## Security Tests
- [x] **Session Security:** Navigating directly to `/` without a valid token correctly blocks access and redirects.
- [x] **Replay Protection:** Attempting to consume the same WhatsApp token twice fails.
- [x] **Identity Isolation:** Modifying local storage or cookies does not grant access to another customer's `customer_id` via RLS.
- [x] **Secret Protection:** `SUPABASE_SECRET_KEY` is completely hidden from the browser bundle.

## Menu & Checkout Tests
- [x] **Authoritative Pricing:** Modifying the cart price in the browser DevTools does not affect the final order total calculated by the Supabase RPC.
- [x] **Address Management:** Adding, editing, and selecting addresses securely persists to the correct customer profile.
- [x] **Scheduled Orders:** Validates dates and times correctly.

## Idempotency & Concurrency Tests
- [x] **Concurrent Idempotency:** Submitting the exact same checkout payload (same `idempotency_key`) twice within milliseconds results in only ONE order being created.
- [x] **Dine-In Table Locking:** Attempting to place two dine-in orders for the same table at the exact same time results in one success and one immediate rejection (rollback) due to the atomic locking mechanism.

## Outbox & Automation Tests
- [x] **Order Event Creation:** Placing an order successfully inserts an `order.created` event into `order_events` in the same transaction.
- [x] **n8n Success Path:** n8n successfully receives the webhook, claims the event, inserts the demo message, and marks the event `COMPLETED`.
- [x] **n8n Failure Path:** If the n8n mock fails, the event is marked `FAILED` and `retry_count` increments.
- [x] **Dead Letter:** Exceeding maximum retries permanently locks the event.
- [x] **Phase 7D Reconciliation:** Running the sweeper script successfully finds stale `PENDING` events and re-triggers them.

## Demo Tests
- [x] **Mobile Simulator:** The WhatsApp simulator works flawlessly over LAN IP, bypassing mobile popup blockers and routing relative URLs correctly.
- [x] **Simulator Polling:** The React polling mechanism correctly fetches new messages from `dev_whatsapp_messages` without unnecessary network spam.
