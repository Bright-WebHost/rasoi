# 12. Authentication & Security

The Pabbas Ordering System uses a highly specialized "passwordless" authentication architecture tailored for WhatsApp.

## The Security Challenge
When a user clicks a link in WhatsApp, how do we know who they are on the website?
Passing the `phone_number` or `customer_id` in the URL (e.g., `?phone=123`) is a massive security vulnerability, as anyone could copy the link or intercept it to impersonate the user or view their orders.

## The WhatsApp-Linked Session Architecture

We solved this using a **One-Time Token Cryptographic Exchange**.

### 1. Token Generation (Server-Side)
When the customer requests the menu, the backend (or currently, the Simulator API) generates a cryptographically secure random 48-byte token using Node's `crypto.randomBytes`.
- A SHA-256 hash of this token is generated.
- The hash is stored in the `ordering_sessions` Supabase table, linked to the `customer_id`, with an `expires_at` (default 5 minutes).
- The raw token is appended to the URL: `https://pabbas.com/auth/whatsapp?token=RAW_TOKEN`.

### 2. Token Consumption (Server-Side Route Handler)
When the user clicks the link, the Next.js `app/auth/whatsapp/route.ts` API intercepts the request.
- It extracts the `RAW_TOKEN` from the URL.
- It computes the SHA-256 hash of `RAW_TOKEN`.
- It executes the `consume_ordering_token` RPC in Supabase.
- The RPC checks if the hash exists, is unused, and unexpired. If so, it marks it `consumed = true` and returns the `customer_id`.
- If valid, Next.js generates an encrypted JWT session cookie (HTTP-only, Secure, SameSite=Lax).
- The user is redirected to `/` (the menu), with the token stripped from the URL.

### 3. Session Persistence
The HTTP-only cookie ensures that XSS attacks cannot steal the user's session. The session is validated on every API request and page load.

## Row Level Security (RLS)
The Next.js client uses the Supabase Anonymous Key to query the database directly. 
RLS policies on `orders`, `customer_addresses`, etc., ensure that a user can only query rows where `customer_id = auth.uid()`. 

Because custom tokens are used instead of Supabase Auth passwords, the Next.js API overrides the default Supabase `auth.uid()` by securely injecting the verified `customer_id` into the Postgres context during queries.
