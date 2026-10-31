"use server";

import { authorize } from "@/lib/auth/staff";
import { INTERNAL_SECRET_HEADER, internalSecret } from "@/lib/server/internal-auth";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getYCloudTemplates() {
  await authorize("blast");

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const apiKey = process.env.YCLOUD_API_KEY;
    if (!apiKey) return { success: false, error: "YCLOUD_API_KEY not configured" };

    const res = await fetch("https://api.ycloud.com/v2/whatsapp/templates?limit=50", {
      headers: { "X-API-Key": apiKey },
      cache: "no-store"
    });

    if (!res.ok) throw new Error(`YCloud API error: ${res.status}`);
    const data = await res.json();
    
    // Filter for approved/sendable templates
    const templates = (data.items || []).filter((t: any) => t.status === "APPROVED" || t.status === "ACTIVE");
    return { success: true, templates };
  } catch (err: any) {
    console.error("getYCloudTemplates error:", err);
    return { success: false, error: err.message };
  }
}

export async function uploadYCloudMedia(formData: FormData) {
  await authorize("blast");

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Unauthorized" };

    const apiKey = process.env.YCLOUD_API_KEY;
    if (!apiKey) return { success: false, error: "YCLOUD_API_KEY not configured" };

    const phoneNumber = process.env.YCLOUD_PHONE_NUMBER?.replace(/\D/g, "");
    if (!phoneNumber) return { success: false, error: "YCLOUD_PHONE_NUMBER not configured" };
    const res = await fetch(`https://api.ycloud.com/v2/whatsapp/media/${encodeURIComponent(`+${phoneNumber}`)}/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: formData
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => null);
      const providerError = errorBody?.error;

      if (providerError?.code === "WHATSAPP_PHONE_NUMBER_UNAVAILABLE") {
        return {
          success: false,
          error: "The YCLOUD_PHONE_NUMBER configured in Vercel is not registered in YCloud. Set it to the exact registered WhatsApp sender number, including its country code, then redeploy.",
        };
      }

      console.error("YCloud media upload failed:", {
        status: res.status,
        code: providerError?.code,
        requestId: providerError?.requestId,
      });
      throw new Error(`YCloud media upload failed (${res.status})`);
    }

    const json = await res.json();
    return { success: true, media_id: json.id };
  } catch (err: any) {
    console.error("uploadYCloudMedia error:", err);
    return { success: false, error: err.message };
  }
}

export async function sendBlast(filter: string, templateName: string, components: any[], phones: string[] = []) {
  await authorize("blast");

  try {
    // Server-side validation
    const apiKey = process.env.YCLOUD_API_KEY;
    if (!apiKey) return { success: false, error: "YCLOUD_API_KEY not configured" };

    const tplRes = await fetch(`https://api.ycloud.com/v2/whatsapp/templates?name=${templateName}`, {
      headers: { "X-API-Key": apiKey }
    });
    const tplData = await tplRes.json();
    const template = (tplData.items || []).find((t: any) => t.name === templateName && t.status === "APPROVED");
    if (!template) {
      return { success: false, error: "Template not found or not approved" };
    }

    const webhookUrl = process.env.N8N_BLAST_WEBHOOK_URL?.trim();
    if (!webhookUrl) return { success: false, error: "N8N_BLAST_WEBHOOK_URL not configured" };

    if (!["all", "active_30", "repeat"].includes(filter)) return { success: false, error: "Invalid campaign audience." };
    if (phones.length > 400) return { success: false, error: "Select no more than 400 contacts at a time." };
    const selectedPhones = [...new Set(phones.map((phone) => String(phone).replace(/\D/g, "")).filter((phone) => phone.length >= 10 && phone.length <= 15))];
    if (phones.length && !selectedPhones.length) return { success: false, error: "No valid contacts were selected." };

    const supabase = createAdminClient();
    const eligibleCustomers: Array<{ phone: string; total_orders: number | null; last_order_date: string | null }> = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error: customerError } = await supabase
        .from("customers")
        .select("phone,total_orders,last_order_date")
        .eq("opted_out", false)
        .eq("is_blocked", false)
        .order("phone")
        .range(offset, offset + 499);
      if (customerError) {
        console.error("sendBlast recipient validation failed:", customerError.message);
        return { success: false, error: "Could not verify campaign contacts. Please try again." };
      }
      eligibleCustomers.push(...(data || []));
      if (!data || data.length < 500) break;
    }

    const selectedSet = new Set(selectedPhones);
    const now = Date.now();
    const eligiblePhones = eligibleCustomers
      .filter((customer) => {
        if (phones.length && !selectedSet.has(customer.phone)) return false;
        if (!phones.length && filter === "repeat" && Number(customer.total_orders || 0) < 2) return false;
        if (!phones.length && filter === "active_30") {
          if (!customer.last_order_date) return false;
          const ageDays = (now - new Date(customer.last_order_date).getTime()) / 86400000;
          if (ageDays > 30) return false;
        }
        return true;
      })
      .map((customer) => customer.phone);
    const excludedContacts = phones.length ? selectedPhones.length - eligiblePhones.length : 0;
    if (!eligiblePhones.length) {
      return { success: false, error: phones.length ? "None of the selected contacts are enabled for WhatsApp campaigns." : "No eligible WhatsApp contacts match this audience." };
    }

    const payload = {
      filter,
      template_name: templateName,
      language: template.language || "en",
      components,
      ycloud_api_key: apiKey,
      phones: eligiblePhones,
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [INTERNAL_SECRET_HEADER]: internalSecret(),
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Blast webhook failed: ${res.status}`);
      return { success: false, error: "Failed to dispatch blast via webhook" };
    }

    const data = await res.json();
    return { success: true, data: { ...data, excluded_contacts: excludedContacts } };
  } catch (err: any) {
    console.error("sendBlast error:", err);
    return { success: false, error: err.message || "Failed to send blast" };
  }
}
