# 6. Next.js Application

The Pabbas web frontend is a modern Next.js (App Router) application. It is strictly responsible for UI rendering, secure session handling, and proxying requests to the Supabase backend. 

## Key Responsibilities

1. **Security & Session Management:** Validates cryptographic tokens, sets HTTP-only cookies, and enforces route guards.
2. **Menu Rendering:** Fetches and displays the dynamic menu from Supabase.
3. **Cart Management:** Provides client-side state for the shopping cart.
4. **Checkout & Validation:** Captures user input (addresses, scheduled times, table selections) and submits it to the backend RPCs.

## Important Files & Directories

| File / Directory | Responsibility |
|------------------|----------------|
| `app/layout.tsx` | Root layout, manages global providers (Cart, Supabase Session). |
| `app/page.tsx` | Main landing page / menu interface. |
| `app/checkout/page.tsx` | The checkout flow for Delivery, Takeaway, and Dine-In. |
| `app/auth/whatsapp/route.ts` | Consumes the one-time token, sets the session cookie, redirects user. |
| `app/api/session/me/route.ts` | Validates the current HTTP-only cookie and returns customer data. |
| `app/api/orders/route.ts` | Securely proxies checkout data to the Supabase `create_customer_order` RPC. |
| `app/dev/whatsapp/page.tsx` | Development-only WhatsApp Simulator. |
| `lib/supabase/` | Supabase client initializers (Client-side, Server-side, Admin/Service-Role). |
| `lib/session/` | Cryptographic utilities for generating and hashing tokens. |
| `components/Cart/` | React components managing the user's shopping cart and totals. |

## Server Components vs Client Components

- **Server Components (Default):** Used for initial data fetching (e.g., loading the menu). This ensures fast initial page loads and excellent SEO.
- **Client Components (`'use client'`):** Used for interactive elements like the `CartProvider`, `AddToCart` buttons, and the Simulator UI.

## Environment Variables

The Next.js app relies heavily on environment variables for security.
- `NEXT_PUBLIC_SUPABASE_URL`: Public endpoint for Supabase.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public anonymous key.
- `SUPABASE_SECRET_KEY`: **SECRET!** Used only in protected API routes (like token generation or polling mock messages) to bypass RLS. Never exposed to the browser.
