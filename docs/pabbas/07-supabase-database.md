# 7. Supabase Database

Supabase is the heart of the Pabbas Ordering System. It is the authoritative system of record. It provides the PostgreSQL database, Row Level Security (RLS) policies, and Edge Functions via Remote Procedure Calls (RPCs).

## Core Tables

| Table | Purpose |
|-------|---------|
| `app_customers` | Stores customer profiles (phone number, name, preferences). |
| `ordering_sessions` | Stores hashed session tokens and tracks consumption state. |
| `customer_addresses` | Stores saved delivery addresses for customers. |
| `menu_categories` | Defines the categorization of the menu (e.g., Ice Creams, Shakes). |
| `menu_items` | Defines the actual products. |
| `menu_item_variants` | Defines sizes or variants of products and their authoritative `price_paise`. |
| `orders` | The root order record, storing order type, status, and snapshots. |
| `order_items` | The individual items purchased in an order. |
| `restaurant_tables` | Defines physical tables and their capacities. |
| `table_reservations` | Records atomic locking of tables for Dine-In orders. |
| `order_events` | The Transactional Outbox for orchestrating post-order flows (e.g., n8n notifications). |
| `dev_whatsapp_messages` | Mock table used exclusively by the WhatsApp Simulator. |

## Key Remote Procedure Calls (RPCs)

Pabbas relies on RPCs to guarantee ACID compliance and atomic operations, bypassing the need for complex, multi-step Next.js API logic that could fail mid-flight.

### `create_customer_order`
The most critical function in the system. It:
1. Validates the customer session.
2. Validates all cart items against the authoritative `menu_item_variants` table.
3. Calculates the true price, ignoring the frontend's calculations.
4. If Dine-in: Attempts to atomically reserve a table.
5. Snapshots the customer's address (if Delivery).
6. Creates the `order` and `order_items` records.
7. **Crucially:** Inserts an `order.created` record into the `order_events` outbox table.
8. Commits or rolls back the entire transaction.

### `consume_ordering_token`
Takes a raw token, hashes it, checks if the hash exists in `ordering_sessions` and is unused/unexpired. If valid, marks it consumed and returns the customer UUID.

### `claim_order_event` / `complete_order_event` / `fail_order_event`
Used exclusively by the n8n automation layer to safely lease, process, and finalize outbox notifications without race conditions.

## Row Level Security (RLS)
RLS policies are enforced on all tables. 
- The Next.js frontend connects using the `anon` key but passes the authenticated customer's UUID securely via a JWT or strict matching.
- Customers can only `SELECT`, `UPDATE`, or `INSERT` records where `customer_id` matches their own UUID.
- The `orders` table ensures a user can never view another user's order history.
