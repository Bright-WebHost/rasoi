"use client";

import { useEffect, useState, useRef, FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendAgentReply, toggleAiSession } from "./actions";

export interface ChatSession {
  id: string;
  phone: string;
  last_message: string;
  last_message_at: string;
  last_message_by: string;
  unread_count: number;
  ai_enabled: boolean;
  ai_disabled_by?: string | null;
  updated_at: string;
}

/** Customer asked for a person (set by /api/ai/tools/handover) and nobody has turned the AI back on yet. */
export const wantsPerson = (s: Pick<ChatSession, "ai_enabled" | "ai_disabled_by">) => !s.ai_enabled && s.ai_disabled_by === "customer_request";

export interface ChatMessage {
  id: string;
  phone: string;
  direction: "inbound" | "outbound";
  content: string;
  sender: "customer" | "ai" | "agent" | "system";
  created_at: string;
}

export default function ChatBoard() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [inputText, setInputText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = useRef(createClient());

  const fetchSessions = async () => {
    const { data, error } = await supabase.current
      .from("chat_sessions")
      .select("*")
      .order("updated_at", { ascending: false });
    
    if (data && !error) {
      // Chats waiting for a person go to the top.
      const list = data as ChatSession[];
      setSessions([...list.filter(wantsPerson), ...list.filter((s) => !wantsPerson(s))]);
    }
    setLoadingSessions(false);
  };

  const fetchMessages = async (phone: string) => {
    setLoadingMessages(true);
    const { data, error } = await supabase.current
      .from("messages")
      .select("*")
      .eq("phone", phone)
      .order("created_at", { ascending: true });
      
    if (data && !error) {
      setMessages(data as ChatMessage[]);
    }
    setLoadingMessages(false);
    scrollToBottom();
  };

  useEffect(() => {
    fetchSessions();

    const channel = supabase.current.channel("pabbas-chat-live");
    channel.on("postgres_changes", { event: "*", schema: "public", table: "chat_sessions" }, () => {
      fetchSessions();
    });
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
      const newMsg = payload.new as ChatMessage;
      setMessages((prev) => {
        if (selectedPhone === newMsg.phone && !prev.some(m => m.id === newMsg.id)) {
          return [...prev, newMsg];
        }
        return prev;
      });
    });
    
    channel.subscribe();
    
    const poller = setInterval(() => {
      fetchSessions();
      if (selectedPhone) {
        supabase.current.from("messages").select("*").eq("phone", selectedPhone).order("created_at", { ascending: true })
          .then(({ data }) => {
            if (data) setMessages(data as ChatMessage[]);
          });
      }
    }, 5000);

    return () => {
      clearInterval(poller);
      supabase.current.removeChannel(channel);
    };
  }, [selectedPhone]);

  useEffect(() => {
    if (selectedPhone) {
      fetchMessages(selectedPhone);
    } else {
      setMessages([]);
    }
  }, [selectedPhone]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPhone || !inputText.trim() || isSending) return;
    
    setIsSending(true);
    setSendError(null);
    const content = inputText.trim();
    
    const res = await sendAgentReply(selectedPhone, content);
    if (res.success) {
      setInputText("");
    } else {
      setSendError(res.error || "Failed to send message");
    }
    setIsSending(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as FormEvent);
    }
  };
  
  const handleToggleAi = async (phone: string, enabled: boolean) => {
    await toggleAiSession(phone, enabled);
  };

  const activeSession = sessions.find(s => s.phone === selectedPhone);

  const formatTime = (ts: string) => {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex h-[calc(100vh-140px)] min-h-[600px] overflow-hidden rounded-[20px] border border-[#EAF0F6] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.02)] mx-auto max-w-[1400px]">
      <div className="w-[320px] flex-shrink-0 flex flex-col border-r border-[#EAF0F6] bg-[#F8FAFB]">
        <div className="p-5 border-b border-[#EAF0F6] flex items-center justify-between bg-white/50 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-extrabold tracking-[-0.2px] text-[#0A1017]">💬 Live Chat</h2>
            <span className="flex h-2 w-2 rounded-full bg-[#137333] shadow-[0_0_8px_rgba(19,115,51,0.6)] animate-pulse"></span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          {loadingSessions ? (
            <div className="p-4 text-sm font-semibold text-[#8799AF] text-center">Loading conversations...</div>
          ) : sessions.length === 0 ? (
            <div className="p-4 text-sm font-semibold text-[#8799AF] text-center">No conversations yet</div>
          ) : (
            <div className="divide-y divide-[#EAF0F6]">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setSelectedPhone(session.phone)}
                  className={`w-full text-left p-4 hover:bg-white transition-colors flex flex-col gap-1.5 ${
                    selectedPhone === session.phone ? "bg-white border-l-[3px] border-l-[#E23744]" : "border-l-[3px] border-l-transparent"
                  }`}
                >
                  <div className="flex justify-between items-center w-full">
                    <span className="font-extrabold text-[14px] text-[#0A1017] tracking-tight flex items-center gap-2">
                      {session.phone}
                      {wantsPerson(session) && (
                        <span className="rounded-full bg-[#FDE8E8] border border-[#F5C2C6] px-2 py-0.5 text-[10px] font-extrabold text-[#C0392B]">🙋 Wants a person</span>
                      )}
                    </span>
                    <span className="text-[10px] font-bold text-[#8799AF] uppercase tracking-widest">{formatTime(session.updated_at)}</span>
                  </div>
                  <div className="text-[12.5px] font-medium text-[#6B7A90] truncate">
                    {session.last_message || "No messages"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white">
        {selectedPhone ? (
          <>
            <div className="px-6 py-4 border-b border-[#EAF0F6] bg-white flex justify-between items-center">
              <div>
                <h3 className="font-extrabold text-[18px] tracking-[-0.2px] text-[#0A1017]">{selectedPhone}</h3>
                <div className="text-[11px] font-bold text-[#8799AF] flex items-center gap-2 mt-1 uppercase tracking-widest">
                  <span className="flex h-1.5 w-1.5 rounded-full bg-[#E67E22] shadow-[0_0_6px_rgba(230,126,34,0.6)] animate-pulse"></span>
                  <span>Staff online</span>
                </div>
              </div>
              <div>
                <button 
                  onClick={() => handleToggleAi(selectedPhone, !activeSession?.ai_enabled)}
                  className={`px-4 py-2 rounded-xl text-[12px] font-extrabold uppercase tracking-widest transition-all border ${
                    activeSession?.ai_enabled 
                      ? "bg-[#FDE8E8] text-[#C0392B] border-[#F5C2C6] hover:bg-[#FADBDD]" 
                      : "bg-[#E6F4EA] text-[#137333] border-[#CEEAD6] hover:bg-[#d6ebd9]"
                  }`}
                >
                  {activeSession?.ai_enabled ? "Take over / Disable AI" : "AI Disabled - Click to Enable"}
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#F8FAFB]">
              {loadingMessages ? (
                <div className="text-center text-sm font-semibold text-[#8799AF] mt-4">Loading messages...</div>
              ) : messages.length === 0 ? (
                <div className="text-center text-sm font-semibold text-[#8799AF] mt-4">No message history found.</div>
              ) : (
                messages.map((msg) => {
                  const isCustomer = msg.sender === "customer";
                  const isAi = msg.sender === "ai";
                  const isSystem = msg.sender === "system";

                  if (isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-4">
                        <div className="bg-white border border-[#EAF0F6] shadow-sm text-[#6B7A90] text-[11px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full">
                          {msg.content} - {formatTime(msg.created_at)}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className={`flex ${isCustomer ? "justify-start" : "justify-end"} mb-6`}>
                      <div className={`max-w-[75%] flex flex-col ${isCustomer ? "items-start" : "items-end"}`}>
                        <div className="text-[10px] font-extrabold text-[#8799AF] mb-1.5 uppercase tracking-widest">
                          {isCustomer ? "Customer" : isAi ? "AI Assistant" : "Staff"}
                        </div>
                        <div 
                          className={`px-5 py-3 rounded-[20px] text-[15px] font-medium leading-relaxed shadow-[0_4px_12px_rgba(0,0,0,0.02)] whitespace-pre-wrap ${
                            isCustomer 
                              ? "bg-white text-[#0A1017] rounded-tl-sm border border-[#EAF0F6]" 
                              : isAi
                                ? "bg-[#FDE8E8] text-[#C0392B] rounded-tr-sm border border-[#F5C2C6]"
                                : "bg-[#0A1017] text-white rounded-tr-sm shadow-[0_4px_12px_rgba(10,16,23,0.15)]"
                          }`}
                        >
                          {msg.content}
                        </div>
                        <div className="text-[10px] text-[#8799AF] mt-1.5 font-bold uppercase tracking-widest">
                          {formatTime(msg.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-white border-t border-[#EAF0F6]">
              {sendError && (
                <div className="mb-3 rounded-xl bg-[#FDE8E8] p-3 text-sm font-semibold text-[#C0392B] border border-[#F5C2C6]">
                  {sendError}
                </div>
              )}
              <form onSubmit={handleSend} className="flex flex-col gap-3">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={isSending}
                  placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                  className="w-full h-[80px] resize-none rounded-xl border border-[#EAF0F6] bg-[#F8FAFB] p-4 text-[14px] font-medium text-[#0A1017] focus:border-[#0D6EFD] focus:ring-2 focus:ring-[#0D6EFD]/10 focus:bg-white outline-none transition-all disabled:opacity-50"
                />
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={!inputText.trim() || isSending}
                    className="bg-[#0A1017] hover:bg-[#111923] text-white font-bold text-sm px-6 py-2.5 rounded-xl transition shadow-[0_4px_12px_rgba(10,16,23,0.15)] disabled:opacity-50 hover:-translate-y-0.5"
                  >
                    {isSending ? "Sending..." : "Reply as Pabbas Staff"}
                  </button>
                </div>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center flex-col text-[#8799AF] bg-[#F8FAFB]">
            <span className="text-[48px] mb-4 opacity-40">💬</span>
            <p className="font-extrabold text-[20px] text-[#0A1017] tracking-tight">Pick a conversation</p>
            <p className="text-[14px] font-medium mt-1">Select a customer from the left to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
}
