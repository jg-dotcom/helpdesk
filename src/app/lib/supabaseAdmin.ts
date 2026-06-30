import { createClient } from '@supabase/supabase-js'

// SERVER-ONLY client. Uses the service role key, which bypasses Row Level
// Security entirely. Never import this file from a 'use client' component —
// it must only be used inside API routes / server components, and the
// SUPABASE_SERVICE_ROLE_KEY env var must NOT have the NEXT_PUBLIC_ prefix
// or it would be shipped to the browser.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
