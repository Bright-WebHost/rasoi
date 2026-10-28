# 2. Project History

The Pabbas Ordering System evolved iteratively. Below is the complete history of how the current architecture was achieved.

### Stage 1: Initial Pabbas Website
The project began as a static presentation website for Pabbas, establishing the brand colors, layout, and UX standards.

### Stage 2: Next.js Implementation
The static site was migrated to **Next.js (App Router)** and **Tailwind CSS** to allow for dynamic data fetching, server components, and modern React development.

### Stage 3: Supabase Integration
**Supabase** was introduced as the backend database and authentication layer, providing PostgreSQL, Row Level Security (RLS), and serverless Edge Functions (via RPCs).

### Stage 4: WhatsApp-First Architecture Decision
A strategic decision was made to abandon traditional email/password authentication. The business objective required a frictionless flow starting from WhatsApp.

### Stage 5: Secure WhatsApp-Linked Sessions
To bridge WhatsApp and the web securely without passwords, we implemented a **One-Time Token** system. When a user clicks a link in WhatsApp, the server generates a token, which the Next.js app consumes to set an HTTP-only secure session cookie mapping to the user's Supabase UUID.

### Stage 6: Customer Profile Memory
The `app_customers` and `customer_addresses` tables were implemented so the system remembers the user across different WhatsApp sessions. The user never types their phone number; it is inherited from the secure session.

### Stage 7: Real Menu Architecture
The hardcoded menu was replaced with a dynamic, database-driven menu (`menu_categories`, `menu_items`, `menu_item_variants`). Pricing was strictly defined in `paise` (integers) to prevent floating-point errors.

### Stage 8: Cart and Checkout
A rich, client-side Cart context was built. Crucially, the frontend calculates estimates, but the **backend Supabase RPC** strictly enforces real prices and totals.

### Stage 9: Delivery / Takeaway / Dine-In
The order schema (`orders`) was expanded to support three distinct order types, capturing necessary metadata (scheduled times, tables, addresses). Address snapshots were implemented to prevent historical orders from changing if a user edits their address later.

### Stage 10: Atomic Table Reservation
Dine-in ordering required a robust concurrency model. We implemented atomic locking via Supabase RPC (`reserve_table`) to prevent double-booking of restaurant tables.

### Stage 11: Transactional Order Outbox
To ensure reliable third-party integrations (like WhatsApp notifications), we implemented the **Transactional Outbox Pattern** (`order_events` table). Orders and their corresponding events are created in a single atomic database transaction.

### Stage 12: n8n Order Event Processing
An **n8n** automation layer was introduced to process `order_events`. Using a webhook, n8n securely "claims" an event, ensuring only one worker processes an order notification at a time.

### Stage 13: WhatsApp Simulator
To demo the entire flow without a costly/complex Meta Business API approval process, a local **WhatsApp Simulator** was built (`/dev/whatsapp`). It acts as a sandbox representing the customer's phone.

### Stage 14: CEO Demo Notification Bridge
The final link was closing the loop: connecting the n8n webhook's success path back to the WhatsApp Simulator. The Simulator polls `dev_whatsapp_messages` to display the simulated confirmation message.

### Stage 15: Future Meta WhatsApp Business API (PLANNED)
The Simulator will be replaced by the real Meta Cloud API. n8n will handle inbound/outbound Meta webhooks. The core ordering system will remain 100% unchanged.

### Stage 16: Future AI Personalization (PLANNED)
An AI Orchestrator will be inserted into the n8n flow to handle unstructured customer text (e.g., "What's good today?"), using Supabase as a read-only context tool, before eventually serving the secure order link.
