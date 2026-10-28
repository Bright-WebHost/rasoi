# 4. Customer Journey & 3-Stage Long-Term Architecture

The architecture of Pabbas is designed to evolve gracefully in three distinct stages. The core business logic (Supabase + Next.js) never changes, while the interaction layer matures over time.

---

## STAGE A — CURRENT CEO DEMO
**(DEVELOPMENT / DEMO ONLY)**

In the current stage, the WhatsApp interaction is entirely simulated.

```mermaid
graph TD
    A[WhatsApp Simulator] -->|Click View Menu| B[Pabbas Next.js API]
    B -->|Create Session| C[Supabase]
    C --> B
    B -->|Return Link| A
    A -->|Open Tab| D[Pabbas Website]
    D -->|Place Order| C
    C -->|Order Event| E[n8n]
    E -->|Write Demo Message| C
    A -->|Poll Messages| C
```

---

## STAGE B — REAL WHATSAPP BUSINESS API
**(PLANNED)**

In Stage B, the Simulator is removed entirely. The Next.js website remains identically functional. Customers interact with a real WhatsApp chat.

```mermaid
graph TD
    A[Customer Phone] -->|Send 'Hi'| B[Meta WhatsApp Cloud API]
    B -->|Webhook| C[n8n]
    C -->|Request Link| D[Pabbas Next.js API]
    D -->|Create Session| E[Supabase]
    D -->|Return Link| C
    C -->|Send WhatsApp Message| B
    B -->|Deliver Link| A
    
    A -->|Click Link| F[Pabbas Website]
    F -->|Place Order| E
    E -->|Order Event| C
    C -->|Send Receipt Template| B
    B -->|Deliver Receipt| A
```

### What Changes:
- Simulator is deleted.
- Meta credentials are added to n8n.
- n8n receives live inbound Meta webhooks.
- n8n sends outbound messages using Meta Session/Template rules.

### What Stays Unchanged:
- Supabase RPCs, database, RLS, outbox.
- Next.js website, menu, cart, checkout.
- The fundamental concept of the "WhatsApp-linked Session".

---

## STAGE C — AI PERSONALIZED CONVERSATION
**(PLANNED)**

In Stage C, we insert an AI Orchestrator into the n8n flow. The AI acts as a conversational layer but **NEVER** acts as the system of record.

```mermaid
graph TD
    A[Customer Phone] -->|'What is good?'| B[Meta WhatsApp API]
    B -->|Webhook| C[n8n]
    C -->|Pass Context| D[AI Agent Orchestrator]
    
    subgraph "Read-Only Context Gathering"
        D -.->|Read Tools| E[Supabase]
        E -.->|Menu, History, Prefs| D
    end
    
    D -->|Generate Response| C
    C -->|Send Text Reply| B
    B -->|Deliver Reply| A
```

### Intended AI Capabilities:
- Natural-language conversations.
- Personalized greetings based on customer history.
- Recommending frequently ordered items.
- Understanding delivery vs dine-in intent contextually.

### IMPORTANT RULE: AI Is Not Authoritative
The AI must **NEVER** be trusted to determine final prices, order totals, menu availability, or table availability. It only guides the user. The final order placement ALWAYS routes through the secure, deterministic Next.js / Supabase architecture.
