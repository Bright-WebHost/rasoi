'use client'

import { useState, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const DEV_CUSTOMERS = [
  { id: 'dev_customer_a', name: 'Customer A', phone: '+91 98765 00001' },
  { id: 'dev_customer_b', name: 'Customer B', phone: '+91 98765 00002' },
]

interface ChatMessage {
  from: 'customer' | 'pabbas'
  text: string
  showCTA?: boolean
  timestamp: string
}

function getTime(): string {
  try {
    return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  } catch {
    return new Date().toLocaleTimeString()
  }
}

/**
 * Parses and formats common Markdown (bold, italic, lists, headings)
 * into a safe React array without using dangerouslySetInnerHTML.
 * This keeps the simulator looking like a real WhatsApp interface.
 */
function formatWhatsAppText(text: string) {
  // 1. Remove markdown headings (e.g. ###)
  let processed = text.replace(/^#+\s+/gm, '')
  
  // 2. Replace bullet points (- or *) with a clean dot
  processed = processed.replace(/^[-*]\s+/gm, '• ')

  // 3. Split by bold and italic syntax to preserve them
  const parts = processed.split(/(\*\*.*?\*\*|\*.*?\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={index} className="font-bold">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      return <em key={index} className="italic">{part.slice(1, -1)}</em>
    }
    return <span key={index}>{part}</span>
  })
}

export default function DevWhatsAppPage() {
  const [selectedCustomer, setSelectedCustomer] = useState(DEV_CUSTOMERS[0])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSupabaseId, setActiveSupabaseId] = useState<string | null>(null)
  const [menuUrl, setMenuUrl] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string>('')
  const [isAiTyping, setIsAiTyping] = useState(false)

  // Silently initialize the session when a customer is selected
  const initializeSession = useCallback(async (customerId: string) => {
    try {
      setLoading(true)
      const res = await fetch('/api/dev/whatsapp/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelUserId: customerId }),
      })
      const data = await res.json()
      if (res.ok && data.url) {
        setMenuUrl(data.url)
        setActiveSupabaseId(data.supabaseCustomerId)
      } else {
        setError('Failed to establish dev session.')
      }
    } catch {
      setError('Network error initializing session.')
    } finally {
      setLoading(false)
    }
  }, [])

  const resetChat = useCallback((customer = selectedCustomer) => {
    setMessages([])
    setInputText('')
    setError(null)
    setLoading(false)
    setIsAiTyping(false)
    setConversationId(crypto.randomUUID())
    setLastPoll(new Date().toISOString())
    initializeSession(customer.id)
  }, [selectedCustomer, initializeSession])

  // Initialize on mount
  useEffect(() => {
    resetChat(selectedCustomer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendMessage = async () => {
    if (!inputText.trim() || isAiTyping || !menuUrl) return
    
    const userText = inputText.trim()
    const customerMsg: ChatMessage = {
      from: 'customer',
      text: userText,
      timestamp: getTime(),
    }

    setMessages(prev => [...prev, customerMsg])
    setInputText('')
    setIsAiTyping(true)
    setError(null)

    try {
      const res = await fetch('/api/dev/whatsapp/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, conversation_id: conversationId, channelUserId: selectedCustomer.id })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to get AI response.')
        setIsAiTyping(false)
        return
      }

      const aiMsg: ChatMessage = {
        from: 'pabbas',
        text: data.reply || 'Sorry, I did not understand that.',
        showCTA: true, // Persistent CTA after EVERY AI response
        timestamp: getTime(),
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (err) {
      setError('Network error reaching AI API.')
    } finally {
      setIsAiTyping(false)
    }
  }

  const handleViewMenuClick = async () => {
    if (!menuUrl) return
    const newWindow = window.open('', '_blank')
    if (newWindow) {
      newWindow.document.write('Loading Pabbas Menu...')
      const absoluteUrl = new URL(menuUrl, window.location.origin).toString()
      newWindow.location.href = absoluteUrl
    } else {
      window.location.href = new URL(menuUrl, window.location.origin).toString()
    }
  }

  // Polling for incoming mock notifications
  const [lastPoll, setLastPoll] = useState<string>(new Date().toISOString())

  useEffect(() => {
    if (!activeSupabaseId) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/dev/whatsapp/messages?customerId=${activeSupabaseId}&after=${encodeURIComponent(lastPoll)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            const newMessages = data.messages.map((m: any) => ({
              from: 'pabbas',
              text: m.message,
              timestamp: new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
              showCTA: true
            }));
            setMessages(prev => [...prev, ...newMessages]);
            setLastPoll(data.messages[data.messages.length - 1].created_at);
          }
        }
      } catch (err) {
        console.error('Polling error', err);
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  }, [activeSupabaseId, lastPoll]);

  return (
    <main className="min-h-screen bg-[#0b141a] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-t-2xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-xs font-bold uppercase tracking-wider bg-amber-500/20 px-2 py-0.5 rounded">
              DEV ONLY
            </span>
            <span className="text-amber-300/70 text-xs font-medium">WhatsApp Simulator (AI V1)</span>
          </div>
          <button onClick={() => resetChat(selectedCustomer)} className="text-amber-400/70 text-xs font-medium hover:text-amber-300 transition">
            Reset
          </button>
        </div>

        <div className="bg-[#0b141a] border-x border-amber-500/30 shadow-2xl overflow-hidden flex flex-col" style={{ minHeight: '520px' }}>
          <div className="bg-[#1f2c34] px-4 py-3 flex items-center gap-3 border-b border-[#2a3942]">
            <div className="w-10 h-10 rounded-full bg-[#ef4f5f] flex items-center justify-center text-white font-extrabold text-sm shrink-0">
              P
            </div>
            <div className="flex-1">
              <h2 className="text-white font-semibold text-[15px] leading-tight">Pabbas Mangalore</h2>
              <p className="text-[#8696a0] text-xs">AI Assistant</p>
            </div>
          </div>

          <div className="px-4 py-3 bg-[#111b21] border-b border-[#2a3942]">
            <label className="block text-[#8696a0] text-xs font-medium mb-2 uppercase tracking-wider">
              Simulated Customer
            </label>
            <select
              value={selectedCustomer.id}
              onChange={(e) => {
                const customer = DEV_CUSTOMERS.find(c => c.id === e.target.value)
                if (customer) {
                  setSelectedCustomer(customer)
                  resetChat(customer)
                }
              }}
              className="w-full bg-[#1f2c34] text-white border border-[#2a3942] rounded-lg px-3 py-2.5 text-sm font-medium focus:border-[#00a884] focus:outline-none disabled:opacity-50"
            >
              {DEV_CUSTOMERS.map(c => (
                <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 px-3 py-4 overflow-y-auto flex flex-col gap-2" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.02\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }}>
            {messages.length === 0 && (
              <div className="flex-1 flex items-center justify-center text-[#8696a0] text-sm text-center px-6 py-12">
                <p>Type a message to chat with the Pabbas AI Assistant.</p>
              </div>
            )}
            
            <AnimatePresence>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.25 }}
                  className={`flex ${msg.from === 'customer' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] rounded-lg px-3 py-2 shadow-sm ${msg.from === 'customer' ? 'bg-[#005c4b] text-white rounded-tr-none' : 'bg-[#1f2c34] text-[#e9edef] rounded-tl-none'}`}>
                    <p className="text-sm whitespace-pre-line leading-relaxed">{formatWhatsAppText(msg.text)}</p>
                    {msg.showCTA && (
                      <button onClick={handleViewMenuClick} className="mt-3 w-full bg-[#00a884] hover:bg-[#00c49a] text-white text-sm font-bold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2">
                        <span>🍽️</span>
                        <span>View Menu & Order</span>
                      </button>
                    )}
                    <div className={`text-[10px] mt-1 text-right ${msg.from === 'customer' ? 'text-white/50' : 'text-[#8696a0]'}`}>
                      {msg.timestamp}
                    </div>
                  </div>
                </motion.div>
              ))}

              {isAiTyping && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                  <div className="bg-[#1f2c34] text-[#e9edef] rounded-lg rounded-tl-none px-4 py-3 shadow-sm flex gap-1">
                    <div className="w-2 h-2 bg-[#8696a0] rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-[#8696a0] rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                    <div className="w-2 h-2 bg-[#8696a0] rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2 mx-2">
                {error}
              </motion.div>
            )}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); sendMessage(); }} className="bg-[#1f2c34] px-3 py-2.5 flex items-center gap-2 border-t border-[#2a3942]">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isAiTyping || !menuUrl}
              placeholder="Type a message"
              className="flex-1 bg-[#2a3942] text-white rounded-full px-4 py-2.5 text-sm placeholder:text-[#8696a0] focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isAiTyping || !menuUrl}
              className="w-10 h-10 rounded-full bg-[#00a884] hover:bg-[#00c49a] disabled:bg-[#2a3942] text-white flex items-center justify-center transition-colors shrink-0 disabled:text-[#8696a0]"
            >
              <svg className="pointer-events-none" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </form>
        </div>

        <div className="bg-amber-500/10 border border-t-0 border-amber-500/30 rounded-b-2xl px-4 py-3">
          <p className="text-amber-300/50 text-[11px] text-center leading-relaxed">
            This simulator mimics the future WhatsApp Business API flow.
            In production, this page will not exist — sessions will be created by n8n.
          </p>
        </div>
      </div>
    </main>
  )
}

