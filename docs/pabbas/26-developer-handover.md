# 26. Developer Handover

## Welcome to the Pabbas Ordering System!
If you are joining this project, this document is your quick-start guide to understanding the architecture.

## The Most Important Concept
**This is a WhatsApp-First application.** 
There are no passwords. The user clicks a link in WhatsApp containing a one-time cryptographic token (`?token=xyz`). The Next.js API consumes this token against Supabase to issue a secure HTTP-only session cookie. The entire system trusts this cookie.

## What is Currently Implemented
As of Phase 7, the system is a **Fully Functional Simulator Demo**. 
If you run `npm run dev` and navigate to `/dev/whatsapp`, you can test the entire flow (Chat -> Website -> Order -> Outbox -> n8n -> Notification).

## Key Architectural Rules You Must Not Break
1. **Never Trust the Frontend for Pricing:** The frontend calculates a total for display, but the final, authoritative price is calculated deep inside the PostgreSQL kernel by the `create_customer_order` RPC.
2. **Never Break the Transactional Outbox:** Orders and notifications are decoupled. The `orders` record and the `order_events` record are created in the exact same SQL transaction. n8n processes the event later. Do not try to execute external API calls directly from Next.js or Supabase Triggers.
3. **Atomic Table Reservations:** Dine-in tables are locked via the RPC. Do not move this logic to the frontend.

## Important Directories
- `app/api/orders/route.ts`: Where orders arrive from the frontend.
- `supabase/`: Contains all SQL migrations. Pay special attention to `orders_rpc_hardening.sql`.
- `n8n/`: Contains the exported workflow JSONs you need to import to process events.
- `app/dev/whatsapp/page.tsx`: The simulator UI.

## Next Recommended Implementation
The immediate next step is **Stage B**: Tearing out the Simulator and connecting real inbound/outbound webhooks to the Meta WhatsApp Business Cloud API via n8n. 

Good luck! If you get stuck, re-read the **System Architecture** and **Order Events Outbox** documentation.
