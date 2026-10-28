"use server";

import { authorize } from "@/lib/auth/staff";

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

    const res = await fetch("https://api.ycloud.com/v2/whatsapp/media/%2B919180348124/upload", {
      method: "POST",
      headers: { "X-API-Key": apiKey },
      body: formData
    });

    if (!res.ok) {
      const errTxt = await res.text();
      console.error("YCloud Media Upload Error:", errTxt);
      throw new Error(`Upload failed: ${res.status}`);
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
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "Unauthorized" };
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.access_token) {
      return { success: false, error: "No access token" };
    }

    const adminClient = createAdminClient();
    const { data: staffData } = await adminClient
      .from("staff_members")
      .select("name")
      .eq("email", session.user.email)
      .maybeSingle();

    if (!staffData) {
      return { success: false, error: "Not a staff member" };
    }

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

    const webhookUrl = process.env.N8N_BLAST_WEBHOOK_URL || "https://staff.brightmedia.tech/webhook/pabbas-blast";

    const payload = {
      filter,
      template_name: templateName,
      language: template.language || "en",
      components,
      ycloud_api_key: apiKey,
      phones,
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Blast webhook failed: ${res.status}`);
      return { success: false, error: "Failed to dispatch blast via webhook" };
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err: any) {
    console.error("sendBlast error:", err);
    return { success: false, error: err.message || "Failed to send blast" };
  }
}
