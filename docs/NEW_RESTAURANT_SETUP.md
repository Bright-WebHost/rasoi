# Reusing Pabbas for a Different Restaurant

This guide explains how to launch a second restaurant on the Pabbas ordering
platform without rebuilding the ordering system from scratch.

## Recommended approach

Use a separate application deployment, Supabase project, domain, and set of
integration credentials for each restaurant. Reuse the code and SQL migrations,
but keep each restaurant's customers, orders, staff, settings, and secrets
isolated.

The current application is configured for one restaurant at a time. Settings
are stored as global key/value rows, menu and order queries are not consistently
scoped by a restaurant ID, and the database schema does not provide complete
tenant isolation. Do not point two restaurants at the same database or app
deployment and assume their data will be separated. Supporting multiple
restaurants in one deployment would require a deliberate multi-tenant redesign,
including tenant IDs, scoped queries, authorization, and Row Level Security.

## What can be reused?

| Area | Reuse or replace? | Notes |
|---|---|---|
| Next.js app and customer ordering flow | Reuse | Keep the core flow; make branding changes only where needed. |
| Dashboard and staff operations | Reuse | Create new staff accounts and assign roles in the new database. |
| Supabase schema and RPCs | Reuse after review | Apply the schema/migrations to a new Supabase project. Do not copy production data. |
| Restaurant settings | Replace | Set the new restaurant's identity, hours, fees, payment instructions, and order types. |
| Menu, prices, categories, and images | Replace | Load the new restaurant's catalog into the database. |
| n8n workflow logic | Usually copy and configure | Import the relevant workflow export, create credentials for the new restaurant, and validate every endpoint and message. |
| WhatsApp Business account, phone number, and templates | Replace | These are restaurant/business-specific Meta resources. |
| Hosting domain and secrets | Replace | Use a separate deployment and generate new secrets. |

## Step-by-step setup

### 1. Create a clean copy of the application

Create a new repository from the approved Pabbas code version (for example,
using a GitHub template or a controlled copy). Do not build the new restaurant
on top of the live Pabbas deployment or its production database.

Record the source commit/version used for the copy. This makes later platform
fixes easier to port to each restaurant.

### 2. Create new infrastructure

Create these resources for the new restaurant:

- A new Supabase project.
- A new hosting project/deployment and restaurant domain.
- A separate n8n instance, or an isolated set of workflows and credentials in
  an existing n8n instance.
- A WhatsApp Business Account and phone-number configuration if using real
  WhatsApp.

Use a separate Supabase project even if the same team administers both
restaurants. Never copy customer, staff, order, or session data from Pabbas.

### 3. Configure application environment variables

Create a fresh local `.env.local` and enter the new restaurant's values. Set
the equivalent variables in the new hosting project's environment settings.
Common variables used by this project include:

```env
NEXT_PUBLIC_SITE_URL=https://orders.example-restaurant.com
NEXT_PUBLIC_SUPABASE_URL=<new Supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new Supabase anon/publishable key>
SUPABASE_SECRET_KEY=<new Supabase secret/service-role key>
SESSION_SECRET=<new long random secret>
PABBAS_N8N_WEBHOOK_SECRET=<new random restaurant-specific secret>
N8N_ORDER_CREATED_WEBHOOK_URL=<new order-created workflow URL>
N8N_STATUS_WEBHOOK_URL=<new order-status workflow URL>
```

Depending on enabled features, also configure variables such as
`N8N_AI_WEBHOOK_URL`, `N8N_WHATSAPP_INBOUND_WEBHOOK_URL`,
`N8N_AGENT_REPLY_WEBHOOK_URL`, `N8N_AI_TOGGLE_WEBHOOK_URL`,
`N8N_BLAST_WEBHOOK_URL`, `PABBAS_AI_WEBHOOK_SECRET`,
`PABBAS_WHATSAPP_INBOUND_SECRET`, `YCLOUD_API_KEY`, and
`YCLOUD_WEBHOOK_SECRET`. `NEXT_PUBLIC_WHATSAPP_NUMBER` is used by the dashboard
for WhatsApp links. Use the exact names referenced by the feature's code and
workflow; this list is not a substitute for checking each integration.

Keep secret/service-role keys only in server-side environments and n8n
credentials. Do not commit `.env.local`, paste secrets into workflow JSON, or
reuse Pabbas production secrets. Use HTTPS for deployed URLs.

Before deploying, inspect the integration code for restaurant-specific fallback
values. For example, some webhook calls currently fall back to the Pabbas
`staff.brightmedia.tech` URLs, and the rider WhatsApp sender has a fixed phone
number. Set the new restaurant's URLs/numbers explicitly or change those
fallbacks; do not let the new deployment silently send traffic to Pabbas.

### 4. Set up the new database

1. Review the SQL files in [`../supabase/`](../supabase/).
2. Apply the schema/migration files to the new Supabase project in dependency
   order, following the project documentation and each file's notes.
3. Do not run rollback files as setup migrations, and do not blindly execute
   every SQL file without checking whether it is optional or environment
   specific.
4. Configure and verify Row Level Security, grants, RPCs, and storage policies.
5. Seed the restaurant's menu and operational records only after the schema is
   ready.

Use the database shape and ordering flow described in
[`pabbas/07-supabase-database.md`](./pabbas/07-supabase-database.md) and
[`pabbas/08-menu-system.md`](./pabbas/08-menu-system.md). Test database
functions against the new project before allowing real orders.

### 5. Replace the restaurant's settings and catalog

Set the new restaurant's name, tagline, address, phone, city, logo, tax
information, hours, order types, minimum order, delivery fee, free-delivery
threshold, payment instructions, and delivery note. Settings can be managed
from the dashboard after the database and an admin login are ready; defaults
are defined in [`../lib/settings/index.ts`](../lib/settings/index.ts).

Add the actual menu to the new database's production `menu_items` data source,
including correct prices, availability, categories, dietary flags, variants,
and image URLs. The customer menu API reads production menu data from Supabase;
changing [`../lib/menu-data.ts`](../lib/menu-data.ts) alone does not replace the
live database catalog.

Also configure the restaurant's delivery pincodes and dine-in tables, if those
order types are enabled. Verify prices and variants in the database because
the backend, not the browser cart, is authoritative at order creation.

### 6. Set up staff and operational data

- Create the new restaurant's staff/admin accounts and assign the least
  privileged roles needed.
- Enter delivery areas and table inventory.
- Configure kitchen, rider, POS, printer, and receipt settings as needed.
- Confirm order statuses, cancellation handling, and staff permissions with
  the restaurant before launch.

### 7. Copy and configure n8n workflows

**You normally do not need to build the workflow logic from zero.** The repo
contains n8n workflow exports under [`../n8n/`](../n8n/), including WhatsApp AI
order bridge, agent reply, blast sender, status notifier, and staff AI toggle
workflows. Some additional workflows are marked inactive. These exports are
starting points, not a guarantee that every workflow is ready for another
restaurant or production.

Use this safe import process:

1. Back up the target n8n instance before importing.
2. Import only the workflow(s) the restaurant actually needs. Do not enable
   every export by default.
3. Open each imported workflow and review every node that calls the app,
   Supabase, Meta/WhatsApp, an AI provider, or another external service.
4. Create new n8n credentials for the new restaurant. Never reuse Pabbas
   credentials or copy credential secrets from an export.
5. Replace URLs, webhook paths/secrets, Supabase project references, business
   phone-number IDs, template names, sender details, AI provider credentials,
   and any restaurant-specific message text.
6. Ensure the workflow's Supabase RPCs/tables and the new database schema
   match. Workflow logic and database functions must be treated as a versioned
   pair.
7. Give each restaurant unique webhook paths (or a separate n8n instance) so
   triggers do not overlap.
8. Test with inactive workflows and test data first. Activate production
   triggers only after the end-to-end checks below pass.

The repository's workflows are not a single generic “order confirmation”
workflow. The older technical documentation describes an order-event receiver,
but current exports include several different operational workflows and
multiple versions of some workflows. Confirm the intended current workflow in
n8n and compare it with the deployed app/database before using it. In
particular, do not import historical/backup/abandoned variants just because
they are present in the repository.

For a real WhatsApp launch, the new restaurant must also provide its own Meta
Business setup, approved templates where required, and WhatsApp credentials.
The development simulator can be used to exercise the web ordering journey
without sending live messages.

### 8. Deploy and verify

Deploy to the new hosting project with only the new restaurant's environment
variables. Then test the full journey using test customers and test orders:

- Customer menu, images, categories, variants, and prices are correct.
- Restaurant hours, paused orders, delivery coverage, minimum order, and
  enabled order types behave correctly.
- Delivery, takeaway, and dine-in flows work as enabled; table reservations
  cannot double-book.
- A completed checkout creates one correct order and its expected order event.
- n8n processes the event once, handles failures/retries, and sends the
  expected message to the correct test recipient.
- Staff login, dashboard permissions, kitchen/order views, receipts, and
  cancellation/update operations work.
- Production URLs use HTTPS, secrets are not exposed to the browser, and no
  Pabbas domain, project ID, menu data, or credentials remain in the new
  deployment.

Use the testing guidance in
[`pabbas/17-testing-verification.md`](./pabbas/17-testing-verification.md),
then launch with a small monitored pilot before directing all customers to the
new ordering link.

## When should we build n8n workflows from scratch?

Start from an existing export when the new restaurant has the same behavior
and data contract. Build or substantially change a workflow only when its
business process differs—for example, it needs a different order-routing
policy, fulfillment partner, payment callback, or notification sequence.
Even then, keep the same core safeguards: authenticate webhooks, validate
inputs, avoid duplicate processing, keep secrets in credentials, and use the
database as the authoritative source for orders and totals.

## Ongoing maintenance across restaurants

Treat each restaurant as its own deployment. When the shared platform code is
updated, test the change against a staging database and representative n8n
workflow before rolling it out to each restaurant. Keep a record of the
application version, SQL migration version, and workflow version deployed for
each one.
