# 13. n8n Automation

**n8n** is the automation and orchestration engine for Pabbas. It is responsible for bridging the gap between the internal Supabase transactional events and external systems like WhatsApp.

## Why n8n?
Instead of writing complex, retry-heavy API logic inside Next.js to handle Meta APIs or third-party webhooks, n8n provides a visual, fault-tolerant workflow builder. If an external API goes down, n8n can automatically pause, retry, or alert.

## The Order Event Receiver Workflow

The primary workflow currently implemented is the **Pabbas | Orders | Event Receiver**. 

### 1. Webhook Trigger
- The workflow starts with a Webhook node listening on `/webhook/pabbas-order-event`.
- It is secured using **Header Auth** (e.g., `Authorization: Bearer <WEBHOOK_SECRET>`).
- When a user places an order, the Next.js backend immediately `POST`s to this webhook containing the `event_id` and `customer_id`.

### 2. Claim Event
- The workflow executes an HTTP Request to the Supabase REST API calling the `rpc/claim_order_event` function.
- This is a critical security step. It prevents duplicate processing if the webhook was fired twice or retried. The RPC returns the full event payload ONLY IF the event is in a `PENDING` state.

### 3. Routing (Test Config)
- An `IF` node checks if the claim was successful. 
- If the event was already processed, it routes to a NOOP (stops).
- It then processes a Test Config node used for local development to simulate success or failure.

### 4. Mock WhatsApp Message
- In Stage A (CEO Demo), the workflow generates a string mimicking a WhatsApp confirmation message: `"Pabbas: We have received your order..."`

### 5. Send to Simulator
- The mock message is sent to the Supabase `dev_whatsapp_messages` table via REST API so the local Next.js simulator can pick it up.

### 6. Complete Event / Fail Event
- If the entire flow succeeds, the workflow calls `rpc/complete_order_event` to mark the event `COMPLETED`.
- If an error occurred (e.g., the Meta API was down), the Error trigger catches it and calls `rpc/fail_order_event`, which increments the retry count and releases the lock for future processing.

## Future Evolution (Stage B)
When migrating to the Meta WhatsApp Business API, the "Mock WhatsApp Message" and "Send to Simulator" nodes will be replaced by the official **WhatsApp node** in n8n, targeting the customer's actual phone number. The Claim and Complete architecture will remain exactly the same.
