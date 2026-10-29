# Rasoi Stock and P&L Planning Report

**Reference reviewed:** Oceana staff dashboard, 2026-10-29

**Scope:** Screen design and backend work needed for Rasoi. Stock and P&L pages were reviewed only; they were not implemented.

## Reference screen design

### POS

Oceana places a scrollable category list with item counts on the left, the searchable dish grid in the center, and the active order/cart on the right. Rasoi's POS previously put category chips above the grid. The Rasoi update moves categories into a counted left rail on wide screens and keeps horizontal chips on narrower screens.

### Tables

Oceana shows occupied tables first and offers round, move, merge, QR, and history actions on each occupied table. Rasoi already has a Merge button on occupied table cards, a target-table dialog, and a `mergeTables` action. The existing feature was kept; it did not need a duplicate UI.

### Stock

The Stock page has three views: Dishes, Ingredients, and Reports. Dish stock supports two models:

- **Simple count:** track units of a sellable dish directly.
- **Recipe based:** calculate how many dishes can be made from available ingredients and recipe quantities.

The views show tracked, low-stock, and out-of-stock counts; search and status filters; grouped stock cards; quantity adjustments; restock, waste, history, and recipe editing; and a stock-take flow. Ingredient management also has CSV import/export. Reports show current stock valuation, period consumption split by sale/waste/adjustment/stock-take, dish recipe margins, and recipe coverage.

### P&L

The P&L page filters by Today, Yesterday, This Week, This Month, All Time, or a custom date range. It shows revenue, cost of goods sold (COGS), gross profit and margin, operating expenses, and net profit; compares totals with the prior period; breaks expenses down by category; lists an expense ledger; supports expense entry and CSV export; and warns when sold dishes lack recipe costs.

## Current Rasoi backend

Rasoi has `menu_items`, `orders`, and `order_items`; order details are also stored in `orders.items_json`. The dashboard currently has analytics at `/dashboard/stats`. There are no Stock or P&L dashboard routes and no inventory, ingredient, recipe-cost, stock-take, purchase, or operating-expense tables in the current SQL schema.

## Backend work needed for Stock

1. **Ingredients and units:** Add ingredient records with category, active status, base unit (`g`, `ml`, `pcs`, etc.), reorder threshold, and a normalized base quantity. Convert recipe and purchase quantities to the same base units to avoid kg/g and l/ml errors.
2. **Stock movement ledger:** Store every received, sold, wasted, manually adjusted, or stock-take quantity as an append-only movement with actor, timestamp, reason, reference, and unit cost. Derive on-hand quantity from movements or maintain a balance updated in the same database transaction.
3. **Dish tracking mode:** Store whether a menu item is tracked as a direct count or derived from a recipe. Direct-count items need their own quantity and threshold.
4. **Recipes:** Add versioned recipes mapping a menu item/variant to ingredient quantities and yield. Record recipe coverage so unknown costs or missing recipes are visible rather than treated as free stock or zero-cost dishes.
5. **Purchases and waste:** Add purchase/receipt entry with supplier, quantity, price, and date; add waste and manual adjustment reasons. The movement ledger should preserve history when ingredient prices change.
6. **Stock takes:** Add stock-take headers and counted lines, record the variance as a movement, and keep the submitted count immutable for audit.
7. **Order consumption:** Deduct recipe ingredients or direct dish counts exactly once for POS, web, and WhatsApp orders. Use an idempotency key per order/line and a database transaction. Decide whether to deduct at kitchen acceptance or at order completion, and reverse/restore stock for cancellations or refunds according to that policy.
8. **Availability and reports:** Query low/out-of-stock items, estimated servings from the limiting recipe ingredient, on-hand valuation, and consumption grouped by movement reason and time range. Add indexes for ingredient, movement, order, and date lookups.
9. **Permissions:** Add staff-role policies for stock viewing, adjustments, purchases, stock takes, and recipe edits; restrict destructive actions and expense/stock audit history.

## Backend work needed for P&L

1. **Expense ledger:** Add expense categories and operating-expense records with amount, date, description, vendor/reference, creator, and void/correction history. Do not overwrite posted expenses silently.
2. **Historical recipe cost:** Snapshot recipe version and ingredient cost when an order is accepted or completed. Otherwise a later supplier price or recipe edit would rewrite historical COGS and profit reports.
3. **Revenue rules:** Define which order statuses count as revenue, how cancellations/refunds/discounts/tax/delivery fees are treated, and whether cash collection or order completion determines the recognized date. Use one rule across dashboard and exports.
4. **Date-safe report queries:** Use the restaurant timezone (`Asia/Kolkata`) and half-open date ranges for the preset and custom filters. Aggregate revenue, COGS, expenses, margin, and comparisons in SQL or a protected RPC rather than loading all orders into the browser.
5. **Coverage warnings:** Report the share of sold lines with a complete recipe-cost snapshot and identify uncovered items. Never present missing COGS as zero without a visible partial-data warning.
6. **Stock valuation:** Value current ingredient balances using a documented costing method (for example, latest purchase cost or weighted average); keep that method consistent between Stock Reports and P&L.
7. **Exports and audit:** Generate CSV from the same authorized report query, and record who created/edited expenses, recipes, and stock adjustments.

## Suggested implementation sequence

1. Confirm the Rasoi menu catalogue and inventory units; seed ingredients, suppliers, and recipe data with the restaurant.
2. Add migrations, staff permissions, purchase/adjustment/stock-take operations, and movement history.
3. Add versioned recipes and idempotent stock consumption/reversal tied to the order lifecycle.
4. Build Stock Dishes, Ingredients, and Reports views; validate balances against a physical count.
5. Add expense entry and historical cost snapshots, then build the P&L report and CSV export.
6. Reconcile a known period against source orders, invoices, and cash records before treating P&L as accounting truth.

The largest dependency is not the page layout: Rasoi needs verified recipes, ingredient units, purchase costs, opening stock counts, and explicit revenue/cancellation rules before the Stock and P&L numbers can be trusted.
