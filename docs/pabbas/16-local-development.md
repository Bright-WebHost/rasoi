# 16. Local Development

This guide outlines how to run the entire Pabbas architecture (Next.js, Supabase, n8n, WhatsApp Simulator) on your local machine.

## Prerequisites
- Node.js (v18+)
- npm
- Supabase CLI (optional, but recommended)
- Docker (optional, if running n8n locally)
- ngrok (optional, if exposing local n8n webhooks to external services)

## 1. Environment Variables
Ensure you have a `.env.local` file in the root directory.
**Never commit this file.**

```env
# Next.js
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Supabase
NEXT_PUBLIC_SUPABASE_URL=<YOUR_SUPABASE_URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<YOUR_ANON_KEY>
SUPABASE_SECRET_KEY=<YOUR_SERVICE_ROLE_KEY>

# n8n Webhook
N8N_WEBHOOK_URL=http://localhost:5678/webhook/pabbas-order-event
N8N_WEBHOOK_SECRET=<YOUR_WEBHOOK_SECRET>
```

## 2. Supabase Setup
1. Create a Supabase project.
2. Execute the SQL migrations in `supabase/` sequentially (e.g., `profiles.sql`, `customer_addresses.sql`, etc.) to build the schema, RLS policies, and RPCs.
3. Seed the `menu_categories`, `menu_items`, and `menu_item_variants` tables.

## 3. n8n Setup
1. Start n8n (via Desktop app, Docker, or Cloud).
2. Import the `Pabbas | Orders | Event Receiver` workflow.
3. Configure the **Header Auth** credential matching your `N8N_WEBHOOK_SECRET`.
4. Configure the **Supabase Custom Auth** credentials inside n8n to match your `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.
5. Ensure the workflow is **Active**.

## 4. Running the Next.js Application
Install dependencies:
```bash
npm install
```

Start the development server:
```bash
npm run dev
```

To test on a mobile device across your Local Area Network (LAN):
```bash
npm run dev -- --hostname 0.0.0.0
```
Then access the app on your phone via `http://<YOUR_PC_IP>:3000/dev/whatsapp`.

## 5. Using the WhatsApp Simulator
Navigate to `http://localhost:3000/dev/whatsapp`.
1. Type "Hi" and press Send.
2. Click "View Menu & Order".
3. Place an order.
4. Verify the confirmation message appears in the simulator chat.
