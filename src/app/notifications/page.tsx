'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Notification = { id: number; message: string; created_at: string; read: boolean; link?: string | null }

const cardStyle: React.CSSProperties = { background: '#1e293b', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px' }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function groupByDate(notifs: Notification[]) {
  const groups: { date: string; notifs: Notification[] }[] = []
  for (const n of notifs) {
    const date = new Date(n.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const last = groups[groups.length - 1]
    if (last?.date === date) last.notifs.push(n)
    else groups.push({ date, notifs: [n] })
  }
  return groups
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState<Notification[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
      if (data) setNotifications(data)
      setLoading(false)
    })
  }, [])

  const grouped = useMemo(() => groupByDate(notifications), [notifications])

  async function markOneRead(id: number) {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)))
    supabase.from('notifications').update({ read: true }).eq('id', id).then(() => {})
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read).map(n => n.id)
    if (!unread.length) return
    await supabase.from('notifications').update({ read: true }).in('id', unread)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="dash-wrap">
      <Nav active="dashboard" />
      <div className="dash-content" style={{ background: '#0f172a', minHeight: '100vh', padding: '2rem' }}>

        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: '1.5rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: '#f1f5f9' }}>Notifications</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>All notifications, most recent first</div>
          </div>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: unreadCount === 0 ? 'default' : 'pointer', background: 'rgba(255,255,255,0.05)', color: unreadCount === 0 ? '#475569' : '#94a3b8', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Mark all read
          </button>
        </div>

        <div style={{ ...cardStyle, padding: loading || grouped.length === 0 ? '3rem 1.5rem' : '1.5rem', maxWidth: '760px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: '#475569', fontSize: '14px' }}>Loading notifications…</div>
          ) : grouped.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#475569' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 10px' }}><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              <div style={{ fontSize: '14px' }}>No notifications yet.</div>
            </div>
          ) : (
            grouped.map(group => (
              <div key={group.date} style={{ marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: '10px' }}>{group.date}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  {group.notifs.map(n => {
                    const rowStyle: React.CSSProperties = { display: 'block', padding: '10px 8px', borderRadius: '8px', textDecoration: 'none', color: 'inherit', background: n.read ? 'transparent' : 'rgba(37,99,235,0.1)', cursor: n.link || !n.read ? 'pointer' : 'default' }
                    const content = (
                      <>
                        <div style={{ fontSize: '13.5px', color: '#e2e8f0', fontWeight: 500 }}>{n.message}</div>
                        <div style={{ fontSize: '11.5px', color: '#475569', marginTop: '2px' }}>{timeAgo(n.created_at)}</div>
                      </>
                    )
                    return n.link ? (
                      <a key={n.id} href={n.link} style={rowStyle} onClick={() => markOneRead(n.id)}>{content}</a>
                    ) : (
                      <div key={n.id} style={rowStyle} onClick={() => !n.read && markOneRead(n.id)}>{content}</div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
