# 10. Dine-In Table System

The Dine-In system enables customers physically located at the restaurant to place orders to their specific table. 

## Business Requirement

Pabbas needs to prevent two different customers from inadvertently sitting at, or ordering to, the exact same table at the exact same time, causing order confusion for the kitchen staff.

## Architecture

The system uses two tables to manage this constraint securely:
1. **`restaurant_tables`:** A dictionary of all physical tables (e.g., "Table 1", "Balcony A") and their seating capacities.
2. **`table_reservations`:** A transactional record linking a `customer_id`, a `table_id`, and an `order_id`.

## Atomic Locking & Concurrency

Checking table availability and placing a dine-in order is prone to Race Conditions. If two users tap "Place Order" for Table 5 simultaneously, both might see it as "available" milliseconds before the order is placed.

To solve this, the locking mechanism is entirely handled inside the `create_customer_order` Supabase RPC as an atomic transaction.

1. When a Dine-In order arrives, the RPC attempts to `INSERT` a record into `table_reservations` for that `table_id` with an `end_time` set to 2 hours in the future.
2. The `table_reservations` table uses a constraint (or query logic) to block overlapping active reservations.
3. If the table is already locked by another active order, the `INSERT` fails.
4. Because this is happening inside the PostgreSQL transaction block of `create_customer_order`, the entire order is rolled back instantly, and the user receives a "Table no longer available" error.

This guarantees that a double-booking is mathematically impossible, regardless of frontend or Next.js API latency.
