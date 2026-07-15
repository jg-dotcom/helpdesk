import { createClient } from '@supabase/supabase-js'
import JoinForm from '../JoinForm'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
)

async function getBusinessName(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('business_profiles')
    .select('business_name')
    .eq('user_id', userId)
    .single()
  return data?.business_name ?? null
}

// Public "join link" page (JAY-29) — mirrors the careers/[userId] page pattern.
// A new hire can self-submit name/email/phone instead of the owner typing an
// invite email in Settings; lands as a pending employees row for the owner to
// finish setting up (role, pay rate, etc.).
export default async function JoinPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  const businessName = await getBusinessName(userId)

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '2rem 1rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '26px', fontWeight: 700, color: '#151823', marginBottom: '0.5rem' }}>
            {businessName ? `Join ${businessName}` : 'Join the team'}
          </div>
          <div style={{ color: '#666', fontSize: '15px' }}>
            Fill in your info below and the team will finish setting up your account.
          </div>
        </div>

        <div style={{ background: '#fff', border: '1px solid #dde1ea', borderRadius: '10px', padding: '1.5rem' }}>
          <JoinForm ownerId={userId} />
        </div>

        <div style={{ textAlign: 'center', marginTop: '2.5rem', fontSize: '12px', color: '#aaa' }}>
          Powered by Helpdesk
        </div>
      </div>
    </div>
  )
}
