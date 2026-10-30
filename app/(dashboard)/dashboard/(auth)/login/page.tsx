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

  const message = state?.error || (urlError === 'unauthorized' ? 'Unauthorized access' : urlError === 'session_expired' ? 'Your session expired. Please sign in again.' : urlError)

  return (
    <div id="login"><div className="lbox">
      <h1>Rasoi</h1><p>Staff dashboard</p>
      {message ? <div className="err">{message}</div> : null}
      <form action={formAction}>
        <input className="f" type="email" name="email" placeholder="Email" autoComplete="username" required />
        <input className="f" type="password" name="password" placeholder="Password" autoComplete="current-password" required />
        <button className="btn" type="submit" disabled={isPending}>{isPending ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div></div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div id="login" />}>
      <LoginForm />
    </Suspense>
  )
}
