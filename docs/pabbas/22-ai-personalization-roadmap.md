# 22. AI Personalization Roadmap (Stage C)

This document outlines the architectural rules for injecting AI (e.g., GPT-4o, Claude) into the Pabbas ordering flow. 

## The Core Philosophy
The AI acts as a **Conversational Orchestrator**, NOT the system of record. 

Customers should feel like they are chatting with a knowledgeable waiter, but when it's time to view the full menu, customize items, and pay, the AI seamlessly hands them off to the deterministic Next.js web application.

## Intended Capabilities
- **Greeting:** "Welcome back, John! Would you like your usual Gadbad Ice Cream today?"
- **Recommendations:** "Since you like chocolate, you should try our new Choco Lava Sunday."
- **Q&A:** "Are there nuts in the Tiramisu?"
- **Intent Routing:** Determining if the user wants Delivery, Takeaway, or Dine-in before generating the menu link.

## AI Architecture

The AI will be integrated via n8n.

1. **Inbound Message:** Customer sends a message on WhatsApp.
2. **Context Gathering (Read-Only):** n8n queries Supabase for the customer's order history, saved addresses, and active menu items.
3. **Prompting:** The context + user message is sent to the LLM.
4. **Tool Use:** The LLM decides whether to:
   - Reply conversationally.
   - Call a tool to generate the Next.js `View Menu & Order` link.
   - Call a tool to check order status.
5. **Response:** n8n sends the LLM's output back to WhatsApp.

## STRICT AI SAFETY & SECURITY RULES

To protect Pabbas from liability and data breaches, the following rules are non-negotiable:

1. **No Pricing Authority:** The AI must NEVER finalize an order, quote a guaranteed price, or apply discounts. Pricing is strictly calculated by the Supabase RPC.
2. **Read-Only Context:** The AI should only be given access to data relevant to the *current* user. RLS must be enforced at the API level before handing context to the AI. The AI must never be given a full Service Role database dump.
3. **No Hallucination Allowed:** The AI prompt must heavily restrict the model to ONLY recommend items currently `is_active = true` in the database.
4. **Deterministic Checkout:** The AI does not build the cart. It may suggest items, but the actual checkout and order confirmation must happen on the Next.js website.
