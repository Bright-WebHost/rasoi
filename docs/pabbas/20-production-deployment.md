# 20. Production Deployment

This document outlines the strict requirements for taking the Pabbas Ordering System out of the "CEO Demo" phase and deploying it to production.

## 1. Hosting Environment
- **Frontend / API:** Deploy the Next.js App to **Vercel**. Vercel provides seamless Edge caching, Serverless functions, and zero-downtime deployments.
- **Database:** Supabase must be upgraded from the local/dev project to a dedicated **Production Supabase Project**.
- **Automation:** Move n8n to a production-grade environment (e.g., n8n Cloud or a dedicated AWS EC2 instance).

## 2. Domain & HTTPS
- Acquire a production domain (e.g., `pabbas.com` or `order.pabbas.com`).
- Update `NEXT_PUBLIC_SITE_URL` in Vercel to match the production domain.
- Ensure all Webhooks (Next.js → n8n, Meta → n8n) use strictly `https://`.

## 3. Environment Variables & Secret Rotation
- **NEVER** copy `.env.local` directly to production.
- Generate a new, cryptographically secure `N8N_WEBHOOK_SECRET`.
- Configure the Production Supabase URL and Keys in Vercel.
- Configure the Production Vercel domain and secrets in n8n.

## 4. Supabase Production Hardening
- Disable the Supabase default `public` schema API entirely if possible, relying only on RPCs for sensitive actions.
- Enforce strict `RLS` policies.
- Disable the Supabase Dashboard SQL Editor for non-admins.
- Setup Daily Backups and Point-In-Time Recovery (PITR).

## 5. Operations & Menu
- The `menu_items` and `menu_item_variants` tables must be purged of demo data.
- The true, verified Pabbas menu must be seeded.
- The `restaurant_tables` inventory must be accurately populated.
- Operating hours logic must be implemented to prevent orders when the restaurant is closed.

## 6. Payments
- Currently, the demo assumes Cash on Delivery or Pay at Counter.
- Production requires integration with a payment gateway (e.g., Razorpay, Stripe) prior to inserting the `create_customer_order` RPC, capturing the `payment_id` atomically.

## 7. Rate Limiting & Monitoring
- Implement Vercel Edge rate limiting on the `/auth/whatsapp` and `/api/orders` routes to prevent DDoS or credential stuffing.
- Add Sentry for production error tracking.
