# 23. Architecture Decisions (ADR)

This document records the major architectural decisions made during the development of the Pabbas Ordering System.

## ADR 1: WhatsApp-First Architecture
**Decision:** Do not require users to download an app or create an email/password account. Use WhatsApp as the primary entry point.
**Reason:** Frictionless onboarding. Users are already on WhatsApp.
**Rejected Alternatives:** Custom iOS/Android apps (too expensive, high barrier to entry). Traditional email logins (slow, high drop-off).

## ADR 2: Next.js + Supabase Split
**Decision:** Use Next.js strictly for UI/UX and secure session proxying, but use Supabase RPCs as the authoritative System of Record.
**Reason:** Next.js Server Actions or API routes can fail mid-flight. Supabase RPCs execute entirely inside the Postgres kernel, guaranteeing ACID transaction compliance for critical tasks (e.g., Table Reservations + Order Creation).
**Rejected Alternatives:** Managing transactions via Prisma/Next.js API (prone to race conditions).

## ADR 3: Secure Ordering Sessions (Tokens)
**Decision:** Use a one-time, expiring, hashed cryptographic token to link a WhatsApp conversation to a web session cookie.
**Reason:** Sending sensitive data (like `customer_id` or `phone`) in the URL exposes the system to URL sharing attacks and interception. A consumed token prevents replay attacks.

## ADR 4: Transactional Outbox (order_events)
**Decision:** Orders and outbound events must be created atomically. n8n processes the events asynchronously.
**Reason:** Prevents the "Two-Phase Commit" problem where the database saves but the webhook fails, or vice-versa. Guarantees 100% notification consistency.
**Rejected Alternatives:** Firing webhooks directly from the Next.js API *before* or *after* database insertion.

## ADR 5: AI as Conversational Layer, Not Business Authority
**Decision:** (Future) The AI will only chat and recommend. It will not execute orders or determine prices.
**Reason:** LLMs hallucinate. If an AI hallucinates a ₹5 price for a ₹500 item, the business is liable. By forcing the final transaction through the deterministic Next.js checkout, security and pricing are guaranteed.
