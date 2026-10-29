/** Sends an outbound WhatsApp text with the configured Rasoi YCloud sender. */
export async function sendWhatsAppText(phone: string, text: string) {
  try {
    const apiKey = process.env.YCLOUD_API_KEY?.trim();
    const from = process.env.YCLOUD_PHONE_NUMBER?.trim();
    let digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
    if (digits.length === 10) digits = `91${digits}`;

    if (!apiKey || !from) return { success: false, error: "WhatsApp sending is not configured." };
    if (digits.length < 11 || digits.length > 15) return { success: false, error: "The customer's WhatsApp number is invalid." };
    if (!text.trim()) return { success: false, error: "The WhatsApp message is empty." };

    const response = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ from, to: `+${digits}`, type: "text", text: { body: text } }),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      console.error("[sendWhatsAppText] YCloud send failed:", response.status, details);
      return { success: false, error: `WhatsApp provider rejected the message (${response.status}).` };
    }

    return { success: true };
  } catch (error) {
    console.error("[sendWhatsAppText] Error:", error);
    return { success: false, error: "WhatsApp message could not be sent." };
  }
}
