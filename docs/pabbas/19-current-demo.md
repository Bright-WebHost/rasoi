# 19. Current Demo

This is the exact runbook for executing the Pabbas CEO Demo. It proves the end-to-end functionality of the "WhatsApp-First" ordering architecture.

## Preparation
1. Ensure Docker/n8n is running and the `Pabbas | Orders | Event Receiver` workflow is **Active**.
2. Start the Next.js development server:
   ```bash
   npm run dev -- --hostname 0.0.0.0
   ```
3. Open `http://localhost:3000/dev/whatsapp` on your PC, OR `http://<LAN-IP>:3000/dev/whatsapp` on your mobile phone connected to the same Wi-Fi.

## Execution Steps

1. **Start Conversation:** In the Simulator, type "Hi" and tap **Send**.
2. **Receive Prompt:** You will immediately receive a simulated response from Pabbas containing the "View Menu & Order" button.
3. **Open Menu:** Tap **View Menu & Order**. A new tab will instantly open, securely authenticating you without a password.
4. **Browse:** You are now on the Pabbas menu. Scroll through categories and view items.
5. **Add to Cart:** Add a "Gadbad Ice Cream" to your cart.
6. **Checkout:** Open the cart and click **Checkout**.
7. **Select Order Type:** Choose **Delivery**, enter a test address (e.g., "123 MG Road"), and click **Place Order**.
8. **Success:** The website will show a "Thank You" screen.
9. **Verify Notification:** Switch back to the WhatsApp Simulator tab. Within 5 seconds, a new message from Pabbas will appear confirming your order (e.g., "Pabbas: We have received your order...").

## Proof Points for the CEO
- **Frictionless:** The customer never had to download an app or remember a password.
- **Secure:** Identity was maintained strictly between the simulated phone and the database.
- **Responsive:** The web interface is vastly superior to ordering via a chatbot menu.
- **Reliable:** The order confirmation arrived automatically via the n8n automation engine.
