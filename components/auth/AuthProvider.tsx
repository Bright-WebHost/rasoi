"use client"

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

/**
 * Ordering session identity from the server-validated cookie.
 * This is NOT a Supabase Auth user — it represents the customer
 * identified by their WhatsApp-linked ordering session.
 */
export interface SessionUser {
  sessionId: string
  customerId: string
  phone: string
  name: string
}

interface AuthContextType {
  /** The current ordering session user, or null if not authenticated. */
  user: SessionUser | null
  /** True while the initial session check is in progress. */
  loading: boolean
  /** Refresh the session state from the server. */
  refreshSession: () => Promise<void>
  /** End the current ordering session. */
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  refreshSession: async () => {},
  signOut: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/session/me')
      if (!res.ok) {
        setUser(null)
        return
      }
      const data = await res.json()
      if (data.authenticated) {
        setUser({
          sessionId: data.sessionId,
          customerId: data.customerId,
          phone: data.phone || '',
          name: data.name || '',
        })
      } else {
        setUser(null)
      }
    } catch {
      setUser(null)
    }
  }, [])

  const refreshSession = useCallback(async () => {
    await loadSession()
  }, [loadSession])

  const handleSignOut = useCallback(async () => {
    try {
      await fetch('/api/session/me', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'signout' }),
      })
    } catch {
      // best effort
    }
    setUser(null)
  }, [])

  useEffect(() => {
    loadSession().finally(() => setLoading(false))
  }, [loadSession])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        refreshSession,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
