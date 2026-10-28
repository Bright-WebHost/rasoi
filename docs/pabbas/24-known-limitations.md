# 24. Known Limitations

It is critical to distinguish between what is currently implemented, what is demo-ready, and what is planned for the future. Do not assume future functionality is currently active.

## CURRENTLY IMPLEMENTED (DONE)
- Complete Next.js Menu & Checkout UI.
- Secure WhatsApp-linked Session Cryptography.
- Customer Profile & Address Memory.
- Server-Side Authoritative Pricing Validation.
- Atomic Dine-In Table Reservation.
- Idempotency & Replay Protection.
- Transactional Order Outbox (`order_events`).
- n8n Event Receiver Workflow (Success & Retry paths).
- **DEVELOPMENT ONLY:** WhatsApp Simulator (`/dev/whatsapp`).

## PLANNED (FUTURE)
- **Real WhatsApp Integration:** The Meta Business Cloud API is NOT connected. The simulator must be replaced in Stage B.
- **AI Orchestrator:** The conversational AI is NOT implemented. The current simulator relies on hardcoded string matching.
- **Payments:** The system currently assumes Cash on Delivery. Razorpay/Stripe integration is required before production.
- **Restaurant Operating Hours:** The system currently allows orders 24/7.
- **Order Status Callbacks:** Currently, the customer only receives an initial "Order Received" confirmation. Notifications for "Out for Delivery" or "Ready for Pickup" require additional webhook paths from the Kitchen Display System (KDS).
- **Real Menu Verification:** The current menu items and prices in Supabase are placeholder seeds. The real Pabbas menu data must be verified.
