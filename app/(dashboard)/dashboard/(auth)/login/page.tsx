'use client'

import { useActionState } from 'react'
import { Suspense } from 'react'
import { login } from './actions'
import { useSearchParams } from 'next/navigation'

const initialState = {
  error: ''
}

function LoginForm() {
  const [state, formAction, isPending] = useActionState(login, initialState)
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')

  return (
    <div className="min-h-screen grid place-items-center bg-white p-6">
      <div className="w-full max-w-[330px]">
        <h1 className="font-[Fraunces] text-[32px] text-[var(--red)] mb-0.5 font-bold">Pabbas</h1>
        <p className="text-[var(--muted)] mb-6">Staff dashboard</p>
        
        {(state?.error || urlError) && (
          <div className="bg-[var(--tint)] border border-[#F5C6CB] text-[var(--red2)] p-2.5 rounded-xl mb-3 text-sm font-semibold">
            {state?.error || (urlError === 'unauthorized' ? 'Unauthorized access' : urlError === 'session_expired' ? 'Your session expired. Please sign in again.' : urlError)}
          </div>
        )}

        <form action={formAction} className="flex flex-col gap-2.5">
          <input 
            type="email" 
            name="email"
            placeholder="Email" 
            autoComplete="username"
            required
            className="w-full p-3 border border-[var(--line)] rounded-xl bg-white focus:outline-none focus:border-[var(--red)] transition-colors"
          />
          <input 
            type="password" 
            name="password"
            placeholder="Password" 
            autoComplete="current-password"
            required
            className="w-full p-3 border border-[var(--line)] rounded-xl bg-white focus:outline-none focus:border-[var(--red)] transition-colors"
          />
          <button 
            type="submit" 
            disabled={isPending}
            className="bg-[var(--red)] text-white p-3.5 rounded-xl font-bold w-full mt-1 disabled:opacity-50"
          >
            {isPending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <LoginForm />
    </Suspense>
  )
}
