'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

export default function DevLoginPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    // Read the value directly from the DOM input — do not store in React state.
    const secret = inputRef.current?.value ?? ''

    try {
      const res = await fetch('/api/dev/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The secret travels once over HTTPS and is never stored anywhere client-side.
        body: JSON.stringify({ secret }),
      })

      if (res.ok) {
        // Clear the input immediately before navigating
        if (inputRef.current) inputRef.current.value = ''
        router.push('/dev/whatsapp')
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Invalid access key. Please try again.')
        if (inputRef.current) inputRef.current.value = ''
        inputRef.current?.focus()
      }
    } catch {
      setError('Network error. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-[#0b141a] flex flex-col items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="w-full max-w-sm"
      >
        {/* Header */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="w-14 h-14 rounded-full bg-[#ef4f5f] flex items-center justify-center text-white font-extrabold text-2xl shadow-lg shadow-[#ef4f5f]/30">
            P
          </div>
          <div className="text-center">
            <h1 className="text-white font-bold text-xl tracking-tight">Pabbas AI Simulator</h1>
            <p className="text-[#8696a0] text-sm mt-1">Development Access</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5">
            <span className="text-amber-400 text-xs font-bold uppercase tracking-wider">
              Restricted — Dev Only
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-[#1f2c34] rounded-2xl border border-[#2a3942] shadow-2xl overflow-hidden">
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="dev-access-key"
                className="text-[#8696a0] text-xs font-semibold uppercase tracking-wider"
              >
                Access Key
              </label>
              <input
                id="dev-access-key"
                ref={inputRef}
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                disabled={loading}
                placeholder="Enter dev access key"
                className="w-full bg-[#111b21] text-white border border-[#2a3942] rounded-xl px-4 py-3 text-sm placeholder:text-[#8696a0] focus:border-[#00a884] focus:outline-none focus:ring-1 focus:ring-[#00a884]/40 transition disabled:opacity-50"
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  key="error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="bg-red-900/30 border border-red-500/30 text-red-300 text-xs rounded-lg px-3 py-2.5 flex items-center gap-2">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                    {error}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              id="dev-login-submit"
              type="submit"
              disabled={loading}
              className="w-full bg-[#00a884] hover:bg-[#00c49a] disabled:bg-[#2a3942] disabled:text-[#8696a0] text-white font-bold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 text-sm"
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
                  </svg>
                  Verifying…
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  Continue
                </>
              )}
            </button>
          </form>

          <div className="border-t border-[#2a3942] px-6 py-3">
            <p className="text-[#8696a0] text-[11px] text-center leading-relaxed">
              Access requires a developer key. Contact the Pabbas tech team for credentials.
            </p>
          </div>
        </div>
      </motion.div>
    </main>
  )
}
