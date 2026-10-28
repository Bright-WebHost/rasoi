# 1. Project Overview

## What is the Pabbas Ordering System?
The Pabbas Ordering System is a modern, mobile-first web application and backend automation system designed to facilitate delivery, takeaway, and dine-in orders for the Pabbas restaurant. 

## Business Problem
Traditional ordering systems require customers to download apps, remember passwords, or navigate clunky web forms. Pabbas wanted a frictionless system where customers can order securely through their most used app: WhatsApp.

## Technical Objective
Build a secure, scalable "WhatsApp-first" ordering architecture. Instead of building a chatbot to handle complex ordering UX (which is frustrating for users), the system bridges the gap between a chat interface and a rich web interface.

Customers start in WhatsApp, click a secure link, seamlessly browse a rich Next.js menu, place their order, and receive their receipt back in WhatsApp.

## Current Capability (STAGE A: CEO DEMO)
The current implementation successfully proves the end-to-end architecture:
- A custom **WhatsApp Simulator** acts as the frontend entry point.
- Customers click **"View Menu & Order"** and are securely routed to the Pabbas Next.js website via a one-time cryptographic token.
- The website provides a beautiful, responsive cart and checkout experience for Delivery, Takeaway, and Dine-In.
- Supabase acts as the secure, authoritative system of record (Database, RPCs, Row Level Security).
- **n8n** acts as the automation layer, securely reading new orders from a Transactional Outbox and sending a mock order confirmation back to the Simulator.

## Long-Term Production Vision
The ultimate vision is to replace the Simulator with the **Meta WhatsApp Business Cloud API**.

In the future, the system will feature:
1. **Customer Recognition:** Recognizing users by their phone number seamlessly.
2. **AI-Assisted Conversations:** Replacing static menus with an intelligent AI orchestrator capable of answering menu questions, making personalized recommendations based on order history, and handling customer support.
3. **Frictionless Ordering:** Securely handing off complex UX (like cart building and payment) to the Next.js web application, while keeping all conversational context in WhatsApp.
