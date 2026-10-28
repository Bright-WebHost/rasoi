# 9. Ordering System

The Ordering System bridges the frontend Cart context and the backend Supabase database, executing strict validation to prevent malicious orders.

## Supported Order Types

Pabbas currently supports three modes of ordering:
1. **Delivery:** Requires a destination address and optionally a scheduled delivery time.
2. **Takeaway:** Optionally requires a scheduled pickup time.
3. **Dine-In:** Requires an available table to be atomically reserved.

## The Checkout Flow

1. **Client-Side Cart:** The user builds a cart. The `CartProvider` in `app/components/Cart/CartContext.tsx` tracks `items` (which are mapped to `variant_id`s).
2. **Checkout Submission:** The user navigates to `/checkout` and clicks "Place Order". The frontend constructs a JSON payload containing the `order_type`, `scheduled_time`, `address_id` (if delivery), `table_id` (if dine-in), and the array of items.
3. **API Proxy:** The request hits `app/api/orders/route.ts`. The API verifies the user's HTTP-only session cookie.
4. **RPC Transaction:** The API forwards the request, along with the authenticated `customer_id`, to the Supabase `create_customer_order` RPC using a Service Role client.

## Data Integrity & Snapshots

Historical data integrity is critical. If a user orders to "Address A", and later edits their address profile to "Address B", the historical order must still display "Address A".

To achieve this, the RPC creates **snapshots**:
- **Menu Prices:** At the exact moment of checkout, the RPC looks up the active `price_paise` and copies it into the `order_items.price_at_time_of_order_paise` column.
- **Addresses:** If delivery, the RPC copies the JSON value of the address into `orders.delivery_address_snapshot`.

## Idempotency

Network issues on mobile devices can cause users to accidentally double-tap "Place Order", resulting in two identical API calls arriving milliseconds apart. 

To prevent duplicate charges or orders:
- The frontend generates an `idempotency_key` (a UUID) when the checkout form is first loaded.
- The `create_customer_order` RPC checks if an order with that exact `idempotency_key` already exists for the customer. 
- If it does, the RPC safely returns the existing order instead of creating a new one.
