"use server";

import { authorize } from "@/lib/auth/staff";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function sendAgentReply(phone: string, message: string) {
  await authorize("chat");

  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.access_token) {
      return { success: false, error: "Unauthorized" };
    }

    const adminClient = createAdminClient();
    const { data: staffData } = await adminClient
      .from("staff_members")
      .select("name")
      .eq("email", session.user.email)
      .maybeSingle();
      
    const agentName = staffData?.name || "Staff";

    const webhookUrl = process.env.N8N_AGENT_REPLY_WEBHOOK_URL?.trim();
    const notifySecret = process.env.RASOI_WHATSAPP_INBOUND_SECRET?.trim() || process.env.RASOI_N8N_WEBHOOK_SECRET?.trim() || "";
    if (!webhookUrl || !notifySecret) return { success: false, error: "Rasoi agent-reply webhook is not configured." };

    const payload = {
      phone,
      message,
      agent_name: agentName,
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "x-rasoi-whatsapp-secret": notifySecret,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`Agent reply webhook failed: ${res.status}`);
      return { success: false, error: "Failed to dispatch message via webhook" };
    }

    return { success: true };
  } catch (err: any) {
    console.error("sendAgentReply error:", err);
    return { success: false, error: err.message || "Failed to send message" };
  }
}

export async function toggleAiSession(phone: string, enabled: boolean) {
  await authorize("chat");

  try {
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !session.access_token) {
      return { success: false, error: "Unauthorized" };
    }

    const adminClient = createAdminClient();
    const { data: staffData } = await adminClient
      .from("staff_members")
      .select("name")
      .eq("email", session.user.email)
      .maybeSingle();
      
    const agentName = staffData?.name || "Staff";

    const webhookUrl = process.env.N8N_AI_TOGGLE_WEBHOOK_URL?.trim();
    const notifySecret = process.env.RASOI_WHATSAPP_INBOUND_SECRET?.trim() || process.env.RASOI_N8N_WEBHOOK_SECRET?.trim() || "";
    if (!webhookUrl || !notifySecret) return { success: false, error: "Rasoi AI-toggle webhook is not configured." };

    const payload = {
      phone,
      enabled,
      agent_name: agentName,
      headers: {
        authorization: `Bearer ${session.access_token}`
      }
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "x-rasoi-whatsapp-secret": notifySecret,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.error(`AI toggle webhook failed: ${res.status}`);
      return { success: false, error: "Failed to toggle AI via webhook" };
    }

    return { success: true };
  } catch (err: any) {
    console.error("toggleAiSession error:", err);
    return { success: false, error: err.message || "Failed to toggle AI" };
  }
}
