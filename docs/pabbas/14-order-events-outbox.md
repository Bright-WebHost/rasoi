# 14. Order Events & Transactional Outbox

Integrating an e-commerce backend with an external notification system (like WhatsApp) introduces the classic "Two-Phase Commit" problem. 

If Pabbas saves an order to the database, and then HTTP posts to WhatsApp, what happens if the WhatsApp API is down? The order is saved, but the customer never gets a receipt. Alternatively, if we call WhatsApp first, and the database crashes, the customer gets a receipt for an order that doesn't exist.

## The Transactional Outbox Pattern

To guarantee 100% consistency, Pabbas uses the **Transactional Outbox Pattern** via the `order_events` table.

1. **Atomic Creation:** Inside the `create_customer_order` RPC, the system creates the `orders` record AND an `order_events` record (type: `order.created`) in the exact same SQL transaction. If either fails, both roll back.
2. **Immediate Webhook:** After the transaction commits successfully, the Next.js API fires an asynchronous, non-blocking webhook to n8n containing the `event_id`.
3. **Decoupled Success:** The checkout process immediately returns a "Success" screen to the user. The checkout **does NOT fail** if n8n or WhatsApp is temporarily unavailable.

## Event Processing Lifecycle

When n8n receives the webhook, it must process the event safely.

### 1. Claim & Lease (`claim_order_event` RPC)
n8n calls this RPC with the `event_id`. The database checks if the event is `status = 'PENDING'`. 
If so, it updates the status to `PROCESSING` and sets a `locked_until` timestamp (e.g., 2 minutes in the future). This "leases" the event to n8n, preventing any other worker from processing it simultaneously.

### 2. Complete (`complete_order_event` RPC)
If n8n successfully sends the WhatsApp message, it calls this RPC to permanently mark the event as `COMPLETED`.

### 3. Fail (`fail_order_event` RPC)
If the WhatsApp API returns a 500 error, n8n calls this RPC. The database increments `retry_count`, resets the status to `PENDING`, and applies Exponential Backoff to the `locked_until` field.

### 4. Dead Letter
If an event fails repeatedly (e.g., > 5 retries), it is marked `FAILED` (Dead Letter Queue) and requires manual administrative intervention.

### 5. Reconciliation (The Sweeper)
What if the Next.js API crashed *after* saving the database but *before* firing the webhook? The event sits in the database as `PENDING` forever.
A cron job (currently Phase 7D script, later a scheduled n8n workflow) periodically polls the `poll_order_events` RPC to sweep up any stale `PENDING` events and re-trigger their webhooks.
