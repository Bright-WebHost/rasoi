# 8. Menu System

The Menu System represents the catalog of products offered by Pabbas. 

## Database Schema

The menu is structured hierarchically across three tables:

1. **`menu_categories`**
   - e.g., "Signature Ice Creams", "Milkshakes", "Savory".
   - Contains a `sort_order` for UI display priority.

2. **`menu_items`**
   - Belongs to a category.
   - e.g., "Gadbad Ice Cream", "Tiramisu".
   - Contains descriptions, dietary flags (e.g., `is_veg`), and `is_active` toggles.

3. **`menu_item_variants`**
   - Belongs to a menu item.
   - e.g., "Regular", "Large", "With Extra Nuts".
   - Contains the **authoritative price**.
   - Contains its own `is_active` toggle.

## Authoritative Pricing Strategy

**CRITICAL RULE:** The Next.js frontend is NEVER trusted for pricing.

To prevent floating-point arithmetic errors and malicious manipulation:
- All prices are stored in **Paise** (integers). For example, ₹250.00 is stored as `25000`.
- The frontend Cart calculates an *estimated* total to display to the user.
- During checkout, the frontend submits an array of `{ variant_id, quantity }`.
- The backend RPC (`create_customer_order`) ignores frontend totals. It loops through the submitted variants, looks up the active `price_paise` directly from the database, and calculates the true, final total.

## UI Rendering

In `app/page.tsx`, Next.js fetches the entire active menu hierarchy from Supabase. It groups items by category and displays them. If an item or variant is marked `is_active = false`, it is omitted from the UI and blocked by backend validation during checkout.
