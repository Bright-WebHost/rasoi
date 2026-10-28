# 11. Customer Profile System

Because the Pabbas Ordering System is "WhatsApp-first", there is no traditional Signup/Login screen. Customers never enter a username, email, or password. 

Identity is established entirely by the fact that the customer possesses the phone associated with their WhatsApp account.

## Core Tables

1. **`app_customers`**
   - The central user record.
   - `phone`: The unique identifier (e.g., `+919876543210`).
   - `name`: Populated either from WhatsApp profile data or updated by the user during checkout.

2. **`customer_addresses`**
   - Related to `app_customers` via `customer_id`.
   - Stores multiple delivery addresses per customer.
   - Includes fields for building, street, landmark, and a boolean `is_default`.

## Address Management

Customers can save and select multiple addresses during the Delivery checkout flow.
- Addresses are retrieved via `GET /api/customer/addresses`.
- New addresses are created via `POST /api/customer/addresses` and immediately become the user's default.
- Addresses are updated/deleted via `PUT / DELETE /api/customer/addresses/[id]`.

## Identity Lifecycle

1. **First Contact:** When a new user messages Pabbas on WhatsApp, the backend (future Stage B) will upsert an `app_customers` record using their WhatsApp phone number.
2. **Session Generation:** A secure, one-time token is generated tying the customer's UUID to a temporary web session.
3. **Session Consumption:** The user visits the website, consuming the token.
4. **Memory:** Any changes the user makes (e.g., correcting their display name, adding a new delivery address) are saved back to their `app_customers` and `customer_addresses` records. The next time they open the menu from WhatsApp, all their previous addresses and preferences are already loaded.
