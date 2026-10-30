import { normalizeWhatsAppPhone } from "@/lib/phone/whatsapp";

/** Sends an outbound WhatsApp text with the configured Rasoi YCloud sender. */
export async function sendWhatsAppText(phone: string, text: string) {
  try {
    const apiKey = process.env.YCLOUD_API_KEY?.trim();
    const from = process.env.YCLOUD_PHONE_NUMBER?.trim();
    const digits = normalizeWhatsAppPhone(phone);

    if (!apiKey || !from) return { success: false, error: "WhatsApp sending is not configured." };
    if (!digits) return { success: false, error: "The customer's WhatsApp number is invalid." };
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

/** Sends an outbound WhatsApp image (by public link) with an optional caption. */
export async function sendWhatsAppImage(phone: string, imageUrl: string, caption = "") {
  try {
    const apiKey = process.env.YCLOUD_API_KEY?.trim();
    const from = process.env.YCLOUD_PHONE_NUMBER?.trim();
    const digits = normalizeWhatsAppPhone(phone);

    if (!apiKey || !from) return { success: false, error: "WhatsApp sending is not configured." };
    if (!digits) return { success: false, error: "The customer's WhatsApp number is invalid." };

    const response = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ from, to: `+${digits}`, type: "image", image: { link: imageUrl, caption } }),
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      console.error("[sendWhatsAppImage] YCloud send failed:", response.status, details);
      return { success: false, error: `WhatsApp provider rejected the bill image (${response.status}).` };
    }

    return { success: true };
  } catch (error) {
    console.error("[sendWhatsAppImage] Error:", error);
    return { success: false, error: "WhatsApp bill image could not be sent." };
  }
}
