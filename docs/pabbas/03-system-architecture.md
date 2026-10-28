# 3. System Architecture

This document outlines the current state of the architecture (Stage A: CEO Demo). 

## Current Architecture Diagram

```mermaid
graph TD
    subgraph "Client Tier"
        Sim["WhatsApp Simulator<br/>(React UI)"]
        Web["Pabbas Ordering Website<br/>(Next.js App)"]
    end

    subgraph "API / Backend Tier"
        API["Next.js Server / API Routes"]
        N8N["n8n Automation Engine"]
    end

    subgraph "Database Tier (Supabase)"
        Auth["Supabase Auth / Sessions"]
        DB["PostgreSQL Database<br/>(Menu, Orders, Outbox)"]
    end

    %% Flow: Simulator to Web
    Sim -- "1. Request Session" --> API
    API -- "2. Generate Token" --> Auth
    API -- "3. Return Secure Link" --> Sim
    Sim -- "4. Open Website" --> Web

    %% Flow: Order Placement
    Web -- "5. Submit Order" --> API
    API -- "6. Execute RPC Transaction" --> DB
    DB -- "7. Atomic Insert:<br/>Order + OrderEvent" --> DB

    %% Flow: Processing
    API -- "8. Trigger Webhook" --> N8N
    N8N -- "9. Claim Event (RPC)" --> DB
    N8N -- "10. Process Notification" --> DB
    N8N -- "11. Mark Event Complete" --> DB

    %% Flow: Simulation Loop
    DB -- "12. Insert Demo Message" --> DB
    Sim -. "13. Polling for Msgs" .-> API
    API -. "14. Read Demo Msgs" .-> DB
```

## Component Roles

### 1. Next.js (App Router)
Acts as both the frontend UI and the secure middle-tier. Contains React components for the cart/menu and secure API routes that validate requests before communicating with Supabase.

### 2. Supabase
The authoritative System of Record. 
- All pricing, inventory, and table availability logic lives here via strictly locked **RPCs (Remote Procedure Calls)**.
- Row Level Security (RLS) ensures that the Next.js frontend can only access data belonging to the authenticated session.

### 3. n8n
The asynchronous workflow orchestrator.
- Listens for new order events.
- Safely "claims" events from the database to prevent duplicate processing.
- Generates outbound notifications.

### 4. WhatsApp Simulator
A development-only tool (`/dev/whatsapp`) used to demonstrate the customer experience without requiring a live Meta developer account. It relies on a mock database table (`dev_whatsapp_messages`) to display outbox notifications.
