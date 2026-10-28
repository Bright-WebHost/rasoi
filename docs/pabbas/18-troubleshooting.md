# 18. Troubleshooting

This document outlines real issues encountered during development and how they were resolved. Do not revert these fixes.

## 1. Localhost vs LAN (Mobile Simulator)
**Symptom:** Opening the simulator on a mobile device via `http://<LAN-IP>:3000/dev/whatsapp` worked, but clicking "View Menu & Order" resulted in a blank page or a navigation error.
**Cause:** The Next.js API hardcoded `http://localhost:3000` as the fallback origin when constructing the URL, and `window.open` bypassed the popup blocker but got stuck on `about:blank`.
**Fix:** The API (`app/api/dev/whatsapp/session/route.ts`) was changed to return a *relative* URL (`/auth/whatsapp...`). The frontend (`page.tsx`) explicitly constructs the absolute URL using `window.location.origin` before passing it to the new tab.
**What not to change:** Do not revert the relative URL logic in the session API. Do not add `noopener,noreferrer` to the `window.open` call.

## 2. Mobile Simulator Touch Bugs
**Symptom:** Tapping the green "Send" icon (paper airplane) did nothing on mobile browsers.
**Cause:** Mobile Safari/Chrome registered the touch event on the SVG element itself, rather than the button, and React's `onClick` failed to bubble.
**Fix:** Added `pointer-events-none` to the SVG and wrapped the input area in an HTML `<form>` to rely on native `onSubmit` behavior.
**What not to change:** Do not replace the `<form>` with a simple `div`.

## 3. n8n Duplicate Workflow Import
**Symptom:** Importing an updated workflow JSON into n8n resulted in two Webhook nodes listening on the same path, causing unpredictable order event processing.
**Cause:** n8n creates new nodes instead of replacing existing ones when importing if IDs mismatch.
**Fix:** Manually delete the duplicate workflow and ensure only one webhook with the exact path `/webhook/pabbas-order-event` exists and is Active.

## 4. Stale Order Events (500 Errors in Supabase)
**Symptom:** n8n fails to claim an event, throwing a Supabase REST error.
**Cause:** The `order_events` table had events stuck in `PROCESSING` forever because a previous developer session crashed mid-flight.
**Fix:** Run the Phase 7D reconciliation script to manually reset `PROCESSING` events back to `PENDING`.

## 5. Environment Variables Missing
**Symptom:** Supabase Admin functions throw an error `Missing SUPABASE_SECRET_KEY`.
**Cause:** Running isolated `.ts` scripts directly via `npx tsx` does not automatically load `.env.local` in the same way `next dev` does.
**Fix:** Use `dotenvx run -- npx tsx <script.ts>` to inject the environment variables.
