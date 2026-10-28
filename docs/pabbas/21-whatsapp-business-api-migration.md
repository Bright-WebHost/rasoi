# 21. WhatsApp Business API Migration (Stage B)

This document outlines the conceptual steps required to replace the local WhatsApp Simulator with the real Meta WhatsApp Business Cloud API.

**IMPORTANT:** The core ordering system (Next.js + Supabase) requires **ZERO** architectural changes to support this migration.

## Prerequisites
- Meta Business Account.
- WhatsApp Business Account.
- A dedicated phone number for the WhatsApp Business API.
- Approved WhatsApp Message Templates (required for business-initiated receipts).

## Step 1: Inbound Webhook (Customer to Pabbas)
Currently, the Simulator hardcodes a "Hi" and generates a link locally.

**Future Implementation:**
1. Configure the Meta App to send inbound webhooks to n8n (e.g., `https://n8n.pabbas.com/webhook/meta-inbound`).
2. When a customer sends "Hi", n8n receives the JSON payload containing the customer's phone number (`WaId`).
3. n8n executes an HTTP Request to a new Next.js API route: `POST /api/session/generate`.
4. This Next.js API will securely verify the n8n request, generate the one-time token, and return the absolute URL `https://pabbas.com/auth/whatsapp?token=RAW_TOKEN`.
5. n8n uses the Meta Cloud API node to send a reply to the customer:
   `"Welcome to Pabbas! Ready to order? [View Menu & Order (Link Button)]"`

## Step 2: Outbound Webhook (Pabbas to Customer)
Currently, n8n writes a mock string to the `dev_whatsapp_messages` table.

**Future Implementation:**
1. Open the existing `Pabbas | Orders | Event Receiver` n8n workflow.
2. Delete the `Mock WhatsApp Message` and `Send to Simulator` nodes.
3. Add a **WhatsApp Business Cloud API** node.
4. Configure the node to use a pre-approved Message Template (e.g., `order_confirmation_receipt`).
5. Map the variables:
   - `Recipient Phone Number` = Derived from the `order.created` event payload (`customer.phone`).
   - `Order ID` = `event.order_id`
   - `Total` = `event.total_paise / 100`
6. The `Complete Event` / `Fail Event` logic remains exactly the same, ensuring robust retries if the Meta API is down.

## Step 3: Decommissioning the Simulator
Once Stage B is fully tested:
1. Delete `app/dev/whatsapp/page.tsx`.
2. Delete `app/api/dev/whatsapp/session/route.ts`.
3. Drop the `dev_whatsapp_messages` table from Supabase.
