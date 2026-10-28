'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { redirect } from 'next/navigation'

export async function login(_previousState: { error: string }, formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  
  if (!email || !password) {
    return { error: 'Email and password are required' }
  }

  const supabase = await createClient()
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return { error: error.message }
  }
  
  if (!data.user) {
    return { error: 'Authentication failed' }
  }

  // Double check authorization immediately (optional but good practice)
  const { data: staffData } = await supabase
    .from('staff_members')
    .select('email')
    .eq('email', data.user.email!)
    .single()
    
  if (!staffData) {
    await supabase.auth.signOut()
    return { error: 'Unauthorized: You are not listed as staff.' }
  }

  redirect('/dashboard')
}
