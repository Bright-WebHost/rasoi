"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Megaphone, Send, Info, CheckSquare, UploadCloud } from "lucide-react";
import { sendBlast, getYCloudTemplates, uploadYCloudMedia } from "./actions";

export default function BlastBoard() {
  const [eligibleCount, setEligibleCount] = useState(0);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent?: number; attempted?: number; error?: string } | null>(null);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  
  const [templates, setTemplates] = useState<any[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);

  const supabase = createClient();

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const { count } = await supabase
          .from("customers")
          .select("*", { count: "exact", head: true })
          .eq("opted_out", false);
        
        if (count !== null) setEligibleCount(count);

        const tpls = await getYCloudTemplates();
        if (tpls.success && tpls.templates) {
          setTemplates(tpls.templates);
          if (tpls.templates.length > 0) {
            setSelectedTemplateName(tpls.templates[0].name);
          }
        } else {
          alert("Error fetching templates: " + (tpls.error || "Unknown"));
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();

    const saved = sessionStorage.getItem("pabbas_blast_selection");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSelectedPhones(parsed);
        }
      } catch (e) {}
    }
  }, [supabase]);

  const selectedTemplate = templates.find((t) => t.name === selectedTemplateName);
  const headerComponent = selectedTemplate?.components?.find((c: any) => c.type === "HEADER");
  const requiresMedia = headerComponent?.format === "IMAGE" || headerComponent?.format === "VIDEO" || headerComponent?.format === "DOCUMENT";

  const handleSend = async () => {
    if (!selectedTemplate) return;
    
    if (requiresMedia && !mediaFile) {
      setResult({ error: "This template requires an image. Please upload one." });
      return;
    }

    setSending(true);
    setResult(null);

    try {
      const components: any[] = [];
      let uploadedUrl = "";

      if (requiresMedia && mediaFile) {
        const formData = new FormData();
        formData.append("file", mediaFile);
        const uploadRes = await uploadYCloudMedia(formData);
        if (uploadRes.success && uploadRes.media_id) {
          // Use the media ID directly — WhatsApp expects { id: "..." } for uploaded media
          components.push({
            type: "header",
            parameters: [
              {
                type: "image",
                image: { id: uploadRes.media_id }
              }
            ]
          });
        } else {
          throw new Error("Image upload failed: " + (uploadRes.error || "Unknown"));
        }
      }

      // Check if template has a URL button with a dynamic parameter
      const buttonComponent = selectedTemplate?.components?.find((c: any) => c.type === "BUTTONS");
      if (buttonComponent) {
        const urlButtonIndex = buttonComponent.buttons?.findIndex((b: any) => b.type === "URL" && b.url?.includes("{{1}}"));
        if (urlButtonIndex !== undefined && urlButtonIndex !== -1) {
          components.push({
            type: "button",
            sub_type: "url",
            index: urlButtonIndex,
            parameters: [
              {
                type: "text",
                text: "pabbas_promo_blast" // Supply the required parameter value
              }
            ]
          });
        }
      }

      const res = await sendBlast(filter, selectedTemplateName, components, selectedPhones);
      if (res.success && res.data) {
        setResult({
          sent: res.data.sent || 0,
          attempted: res.data.attempted || 0,
          error: res.data.error || undefined,
        });
      } else {
        setResult({ error: res.error || "Blast did not complete. Check the workflow is active in n8n." });
      }
    } catch (e: any) {
      setResult({ error: e.message || "An error occurred while sending." });
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center text-gray-400">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[800px] mx-auto pb-20 md:pb-6 px-1 sm:px-2 space-y-6">
      <div className="flex flex-col gap-1 mb-2">
        <h1 className="text-[26px] font-extrabold tracking-[-0.6px] text-[#0A1017]">Marketing Blast</h1>
        <p className="text-sm font-semibold text-[#8799AF]">Send WhatsApp campaigns to your saved customers.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-[20px] border border-[#B8D5F6] bg-gradient-to-br from-[#EAF3FF] to-[#DCE9FA] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[#1A5FA8] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
              <Megaphone className="h-3.5 w-3.5" /> Eligible Contacts
            </div>
            <div className="text-[36px] font-extrabold tracking-[-1px] text-[#1A5FA8]">{eligibleCount}</div>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#1A5FA8]" />
        </div>

        <div className="relative overflow-hidden rounded-[20px] border border-[#F5C2C6] bg-gradient-to-br from-[#FFF0F1] to-[#FDE8E8] p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)] hover:-translate-y-1 hover:shadow-lg transition-transform duration-300">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-[#C0392B] mb-2 font-extrabold uppercase tracking-widest text-[11px] opacity-80">
              <CheckSquare className="h-3.5 w-3.5" /> Selected
            </div>
            <div className="text-[36px] font-extrabold tracking-[-1px] text-[#C0392B]">{selectedPhones.length}</div>
          </div>
          <div className="absolute -right-4 -bottom-4 w-24 h-24 rounded-full opacity-[0.04] bg-[#C0392B]" />
        </div>
      </div>

      {selectedPhones.length > 0 ? (
        <div className="rounded-[20px] border border-[#F5C2C6] bg-[#FDE8E8] p-5 text-[14px] text-[#C0392B] font-bold flex justify-between items-center shadow-[0_4px_12px_rgba(226,55,68,0.1)]">
          <span>Sending to the {selectedPhones.length} contacts you picked.</span>
          <button 
            onClick={() => {
              setSelectedPhones([]);
              sessionStorage.removeItem("pabbas_blast_selection");
            }}
            className="underline hover:text-[#9c291d] font-extrabold text-[11px] uppercase tracking-widest"
          >
            Clear selection
          </button>
        </div>
      ) : (
        <div className="rounded-[20px] border border-[#FDEBBA] bg-[#FFF8E6] p-5 text-[14px] text-[#B08600] font-bold shadow-sm">
          No contacts selected individually (choose specific people from the Contacts page) — this will go to the whole group selected below.
        </div>
      )}

      <div className="space-y-6 rounded-[20px] border border-[#EAF0F6] bg-white/50 backdrop-blur-md p-6 sm:p-8 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
        <div>
          <label className="mb-2 block text-[11px] font-extrabold text-[#8799AF] uppercase tracking-widest">
            Who to target {selectedPhones.length > 0 && "(Ignored while a selection is active)"}
          </label>
          <select
            className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] p-3.5 text-[14px] font-bold text-[#0A1017] focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white outline-none transition-all disabled:opacity-50"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            disabled={selectedPhones.length > 0}
          >
            <option value="all">Everyone ({eligibleCount} contacts)</option>
            <option value="active_30">Ordered in the last 30 days</option>
            <option value="repeat">Repeat customers only</option>
          </select>
        </div>

        <div>
          <label className="mb-2 block text-[11px] font-extrabold text-[#8799AF] uppercase tracking-widest">Select Template</label>
          <select
            className="w-full rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] p-3.5 text-[14px] font-bold text-[#0A1017] focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white outline-none transition-all"
            value={selectedTemplateName}
            onChange={(e) => {
              setSelectedTemplateName(e.target.value);
              setMediaFile(null);
            }}
          >
            {templates.length === 0 && <option value="">No approved templates found</option>}
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>
        </div>

        {requiresMedia && (
          <div>
            <label className="mb-2 block text-[11px] font-extrabold text-[#8799AF] uppercase tracking-widest">
              Campaign Media ({headerComponent.format})
            </label>
            <label className="flex flex-col items-center justify-center w-full h-40 border-[2px] border-[#C9D4E0] border-dashed rounded-[16px] cursor-pointer bg-[#F8FAFB] hover:bg-[#EAF0F6] transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <UploadCloud className="w-10 h-10 mb-3 text-[#A1B2C6]" />
                <p className="text-[14px] font-bold text-[#0A1017]">
                  <span className="text-[#0D6EFD]">Click to upload</span> {mediaFile ? mediaFile.name : `a campaign ${headerComponent.format.toLowerCase()}`}
                </p>
              </div>
              <input 
                type="file" 
                className="hidden" 
                accept={headerComponent.format === 'DOCUMENT' ? '.pdf' : headerComponent.format === 'VIDEO' ? 'video/*' : 'image/*'} 
                onChange={(e) => setMediaFile(e.target.files?.[0] || null)} 
              />
            </label>
            <p className="mt-3 text-[12px] font-semibold text-[#8799AF]">
              This template requires a {headerComponent.format.toLowerCase()} header. It will be securely uploaded to YCloud before sending.
            </p>
          </div>
        )}
      </div>

      <div className="rounded-[20px] border border-[#FDEBBA] bg-[#FFF8E6] p-5 text-[14px] font-bold text-[#B08600] flex items-start gap-3 shadow-sm">
        <Info className="h-5 w-5 shrink-0 mt-0.5" />
        <p>
          Sends about one per second — leave this tab open until complete. Do a test run first!
        </p>
      </div>

      <button
        onClick={handleSend}
        disabled={sending}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E23744] px-6 py-4 text-[16px] font-extrabold text-white shadow-[0_4px_12px_rgba(226,55,68,0.25)] hover:-translate-y-0.5 hover:shadow-[0_6px_16px_rgba(226,55,68,0.35)] disabled:opacity-50 transition-all disabled:transform-none disabled:shadow-none"
      >
        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        {sending ? "Processing & Sending..." : "Send Blast"}
      </button>

      {result && (
        <div className="mt-6 rounded-[20px] border border-[#EAF0F6] bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.02)]">
          <div className="flex gap-4">
            <div className="flex-1 rounded-[16px] border border-[#CEEAD6] bg-[#E6F4EA] p-5">
              <div className="text-[11px] font-extrabold uppercase tracking-widest text-[#137333]">Sent of {result.attempted || 0}</div>
              <div className="text-[36px] font-extrabold tracking-[-1px] text-[#0D5424]">{result.sent || 0}</div>
            </div>
          </div>
          {result.error && (
            <div className="mt-4 rounded-xl bg-[#FDE8E8] p-4 text-[13px] font-bold text-[#C0392B] border border-[#F5C2C6]">
              <span className="font-extrabold">Meta says:</span> {result.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
