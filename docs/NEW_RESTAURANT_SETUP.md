# Rasoi Project Setup

This guide records the Rasoi copy's setup requirements and the checks needed
before using the platform for another restaurant.

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
NEXT_PUBLIC_SITE_URL=<Rasoi app URL>
NEXT_PUBLIC_SUPABASE_URL=https://xwakalryzigtvoirwooq.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<new Rasoi anon/publishable key>
SUPABASE_SECRET_KEY=<new Rasoi secret/service-role key>
SESSION_SECRET=<new random secret, separate from Supabase keys>
DEV_ACCESS_KEY=<new random developer-access secret>
RASOI_AI_WEBHOOK_SECRET=<new Rasoi AI integration secret>
RASOI_WHATSAPP_INBOUND_SECRET=<new Rasoi WhatsApp integration secret>
RASOI_N8N_WEBHOOK_SECRET=<new Rasoi n8n integration secret>
YCLOUD_API_KEY=<new Rasoi YCloud API key>
YCLOUD_PHONE_NUMBER=<Rasoi WhatsApp sender number>
YCLOUD_WEBHOOK_SECRET=<new Rasoi YCloud webhook secret>
NEXT_PUBLIC_WHATSAPP_NUMBER=<Rasoi WhatsApp number, country code included>
N8N_ORDER_CREATED_WEBHOOK_URL=<Rasoi order-created workflow URL>
N8N_STATUS_WEBHOOK_URL=<Rasoi order-status workflow URL>
N8N_AI_WEBHOOK_URL=<Rasoi AI workflow URL>
N8N_AGENT_REPLY_WEBHOOK_URL=<Rasoi agent-reply workflow URL>
N8N_AI_TOGGLE_WEBHOOK_URL=<Rasoi AI-toggle workflow URL>
N8N_BLAST_WEBHOOK_URL=<Rasoi campaign workflow URL>
N8N_WHATSAPP_INBOUND_WEBHOOK_URL=<Rasoi inbound WhatsApp workflow URL>
NEXT_PUBLIC_BLAST_BUTTON_URL_PARAM=<approved Rasoi campaign URL button parameter>
```

The tracked [`.env.example`](../.env.example) lists these names without
credentials. The copied `.env.local` is ignored by Git and is configured with
the Rasoi Supabase URL; its project keys and copied Pabbas integration values
have been cleared so they cannot be reused accidentally.
`RASOI_N8N_API_KEY` is not required by the app; enter a new n8n API key only if
the local workflow-management helper is reviewed and intentionally used. The
selected `apply_code.py` helper no longer has a source-instance URL or workflow
ID; it requires `RASOI_N8N_BASE_URL`, `RASOI_N8N_WORKFLOW_ID`, and
`RASOI_N8N_API_KEY`,
and no longer copies a YCloud API key from webhook payload data. Other local
workflow helper scripts still need review before use. Keep the legacy
`N8N_API_KEY` unset until those tools have been retargeted and reviewed.

Keep secret/service-role keys only in server-side environments and n8n
credentials. Do not commit `.env.local`, paste secrets into workflow JSON, or
reuse Pabbas production secrets. Use HTTPS for deployed URLs.

Rasoi webhook calls no longer have Pabbas fallback URLs, and WhatsApp senders
now use `YCLOUD_PHONE_NUMBER`. Calls that lack a Rasoi endpoint or credential
stay disabled or return a configuration error. Configure each endpoint and
update the selected n8n workflow to accept the matching `x-rasoi-*` header
before enabling the integration. No workflow was imported or changed remotely.
The old workflow exports and remaining local helper scripts still require a
separate review and new n8n credentials.

### 4. Set up the new database

Use the single-file fresh-project script
[`../supabase/rasoi_initialization.sql`](../supabase/rasoi_initialization.sql).
It consolidates the Rasoi core baseline with app customer sessions, saved
addresses, table/rider operations, AI cart and menu-variant objects, staff
roles, ordering RPCs, operational settings, RLS/grants, and the `menu_images`
storage bucket. It intentionally seeds no customers, staff, menu items, delivery
pincodes, or tables. Orders start paused until confirmed business settings are
entered. The script has not been applied or executed against remote Postgres.

You reported successful read-only SQL Editor queries with no public columns,
functions, or policies. A direct Postgres connection from this environment
failed certificate validation, so no remote migration was attempted. Review the
whole script, then run that one file in the Rasoi project's Supabase SQL Editor.

Do not run the legacy migrations alongside it. `phase4_menu.sql`,
`phase5_orders.sql`, `orders_rpc_hardening.sql`, and the order-event scripts use
an incompatible older schema generation; `phase6_tables.sql` seeds example
tables; `pabbas_menu_seed.sql` contains Pabbas inventory. Keep those files as
historical source material. The n8n exports also need separate contract review
and new Rasoi credentials before activation.

`lib/supabase/types.ts` still models an older price-in-paise contract and is
shared with n8n. Review/update it only after the new Rasoi schema and workflow
contract are confirmed. Populate verified Rasoi dietary flags and menu variants
before enabling those customer ordering features.

The historical [`pabbas/07-supabase-database.md`](./pabbas/07-supabase-database.md)
and [`pabbas/08-menu-system.md`](./pabbas/08-menu-system.md) describe the source
project's behavior; use them as reference only and verify every object against
the Rasoi baseline. Test database functions against the new project before
allowing real orders.

### 5. Replace the restaurant's settings and catalog

Set Rasoi's name, tagline, address, phone, city, logo, tax
information, hours, order types, minimum order, delivery fee, free-delivery
threshold, payment instructions, and delivery note. Settings can be managed
from the dashboard after the database and an admin login are ready; defaults
are defined in [`../lib/settings/index.ts`](../lib/settings/index.ts).

Add Rasoi's actual menu to the new database's production `menu_items` data source,
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
