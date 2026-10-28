# 15. Notification System

The Notification System is designed with the **Adapter Pattern** in mind. Pabbas does not care *how* a message is sent; it only cares that an `order_event` was generated. n8n acts as the adapter.

## Current Implementation (Stage A: Simulator)

Because we cannot send real WhatsApp messages without a Meta Business account, the notification system currently loops back into the local development environment.

1. `create_customer_order` generates `order.created`.
2. n8n receives the webhook and claims the event.
3. n8n parses the order payload to generate a confirmation string:
   `"Pabbas: We have received your order (Delivery). Order ID: PAB-123. Total: ₹250."`
4. n8n makes a REST API `POST` to Supabase, inserting this string into `dev_whatsapp_messages`.
5. The WhatsApp Simulator UI polls `dev_whatsapp_messages` and displays it to the user.

## Future Implementation (Stage B: Meta API)

When migrating to production, the Pabbas database and Next.js backend require **ZERO** changes to the notification logic.

The only changes occur in n8n:
1. The `Mock WhatsApp Message` node is replaced by an official `WhatsApp Business Cloud API` node.
2. The `Send to Simulator` node is deleted.
3. The n8n credentials are updated with the Meta Access Token.
4. The message payload is mapped to an approved WhatsApp Message Template (required by Meta for outbound business-initiated messages, like receipts).

This decouples the business logic (Next.js) from the communication medium (WhatsApp). If Pabbas ever wanted to add SMS or Email receipts, it would simply be an additional branch inside the n8n workflow.
