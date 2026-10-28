# 25. Future Development Roadmap

The Pabbas Ordering System is designed to be rolled out in phased, low-risk stages.

## PHASE A: Current CEO Demo (DONE)
Goal: Prove the end-to-end architecture using local simulation.
Status: Completed. Ready for demonstration.

## PHASE B: n8n Production Migration
Goal: Move the n8n orchestration from the developer's local machine/Docker to Pabbas's official n8n Cloud or AWS account.
Dependencies: Provisioning production infrastructure.
Changes: Export/Import workflows, update webhook URLs.

## PHASE C: Meta WhatsApp Business API Integration
Goal: Replace the local Simulator with the real Meta Cloud API.
Dependencies: Meta Business Verification, phone number approval, message template approval.
Changes: Delete `app/dev/whatsapp`. Update n8n nodes to point to Meta. 

## PHASE D: Production Hardening & Payments
Goal: Secure the app for real-world traffic.
Dependencies: Payment gateway account (e.g., Razorpay).
Changes: Integrate payment checkout in Next.js. Pass `payment_id` to Supabase `create_customer_order` RPC. Seed the final, verified restaurant menu.

## PHASE E: Kitchen Display System (KDS) Integration
Goal: Route orders directly to the kitchen and provide status updates back to the customer.
Dependencies: Existing POS/KDS API access.
Changes: n8n workflow branches to push `order.created` payloads to the POS. POS sends webhooks back to n8n when order status changes to trigger WhatsApp updates.

## PHASE F: AI Conversational Layer
Goal: Introduce a smart AI assistant to handle WhatsApp queries.
Dependencies: OpenAI / Anthropic API keys.
Changes: Insert AI Agent node into the inbound n8n workflow. Provide read-only Supabase context to the agent.

## PHASE G: Advanced Personalization
Goal: The AI begins making intelligent recommendations based on a user's past `order_items` history and preferences.
