# Rasoi Restaurant Ordering Platform

This is a restaurant ordering platform built with Next.js, Supabase, and n8n.
It includes a customer menu and checkout, staff dashboard, order management,
and WhatsApp integrations.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Configure the required
environment variables and the Rasoi Supabase schema before using database-backed
features. See [New Restaurant Setup](./docs/NEW_RESTAURANT_SETUP.md).

## Reuse for another restaurant

Use a separate deployment and Supabase project for each restaurant. The
platform code and suitable n8n workflow exports can be reused, but menu,
settings, credentials, domains, and WhatsApp/Meta configuration must be
restaurant-specific. Read the
[New Restaurant Setup Guide](./docs/NEW_RESTAURANT_SETUP.md) before cloning
or deploying this project.

## Project documentation

- [Rasoi and new-project setup](./docs/NEW_RESTAURANT_SETUP.md)
- [Pabbas source technical documentation (historical)](./docs/PABBAS_COMPLETE_TECHNICAL_DOCUMENTATION.md)
- [Pabbas source developer handover (historical)](./docs/pabbas/26-developer-handover.md)
- [Pabbas source n8n automation (historical)](./docs/pabbas/13-n8n-automation.md)
- [Pabbas source production deployment (historical)](./docs/pabbas/20-production-deployment.md)
