'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { SettingsIcon, SignOutIcon } from './Icons'

type Props = {
  active: 'dashboard' | 'time' | 'hiring' | 'payroll' | 'reports' | 'settings' | 'messages' | 'activity'
  viewerRole?: 'owner' | 'admin' | 'manager' | 'employee'
  viewerPerms?: Record<string, boolean> | null
}

type Notification = { id: number; message: string; created_at: string; read: boolean; link?: string | null }

type PaletteData = {
  ptos:      Array<{ id: number; employeeName: string; start_date: string; end_date: string; type: string; reason: string | null }>
  swaps:     Array<{ id: number; requesterName: string; targetName: string | null; notes: string | null }>
  callouts:  Array<{ id: number; employee_id: number | null; employeeName: string; start_time: string; end_time: string }>
  employees: Array<{ id: number; name: string; role: string }>
}

function fmtShort(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmt12(t: string) {
  const [h, m] = t.split(':'); const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  )
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

function IconDashboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  )
}

function IconTime() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  )
}

function IconHiring() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}

function IconPayroll() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  )
}

function IconReports() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  )
}

function IconMessages() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function IconActivity() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  )
}

function IconBell() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}

// ──────────────────────────────────────────────────────────────────────────────

export default function Nav({ active, viewerRole = 'owner', viewerPerms }: Props) {
  const isOwnerOrAdmin = viewerRole === 'owner' || viewerRole === 'admin'
  const canSeePayroll = isOwnerOrAdmin || (viewerPerms?.payroll_view ?? false) || (viewerPerms?.payroll_log ?? false)
  const canSeeHiring  = isOwnerOrAdmin || (viewerPerms?.hiring_view ?? false)
  const canSeeSettings = isOwnerOrAdmin

  const [userEmail, setUserEmail]     = useState('')
  const [displayName, setDisplayName] = useState('')
  const [showMenu, setShowMenu]       = useState(false)
  const [showNotifs, setShowNotifs]   = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadMessages, setUnreadMessages] = useState(0)
  const [trialBanner, setTrialBanner] = useState<{ daysLeft: number; status: string } | null>(null)
  const menuRef        = useRef<HTMLDivElement>(null)
  const notifsRef      = useRef<HTMLDivElement>(null)
  const notifDropdownRef = useRef<HTMLDivElement>(null)
  const [notifPos, setNotifPos] = useState<{ left: number; bottom: number } | null>(null)

  // ── Command palette ────────────────────────────────────────────────────────
  const [showPalette, setShowPalette]   = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteData, setPaletteData]   = useState<PaletteData | null>(null)
  const [paletteHi, setPaletteHi]       = useState(0)
  const paletteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setUserEmail(session.user.email ?? '')

      const fullName = (session.user.user_metadata?.full_name ?? '').trim()
      if (fullName) {
        const parts = fullName.split(' ')
        setDisplayName(parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : ''))
      }

      fetch('/api/billing/status', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(data => {
          if (data.status === 'trialing' && data.trialDaysLeft <= 7) {
            setTrialBanner({ daysLeft: data.trialDaysLeft, status: 'trialing' })
          } else if (data.status === 'past_due' || data.status === 'canceled') {
            setTrialBanner({ daysLeft: 0, status: data.status })
          }
        })
        .catch(() => {})

      fetch('/api/messages/channels', { headers: { Authorization: `Bearer ${session.access_token}` } })
        .then(r => r.json())
        .then(data => {
          if (data.channels) {
            const total = (data.channels as { unreadCount: number }[]).reduce((s, c) => s + c.unreadCount, 0)
            setUnreadMessages(total)
          }
        })
        .catch(() => {})

      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => { if (data) setNotifications(data) })

      channel = supabase
        .channel(`notifications:${session.user.id}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'notifications',
          filter: `user_id=eq.${session.user.id}`,
        }, payload => {
          setNotifications(prev => [payload.new as Notification, ...prev].slice(0, 20))
        })
        .subscribe()
    })

    function handleClick(e: MouseEvent) {
      if (menuRef.current   && !menuRef.current.contains(e.target as Node))   setShowMenu(false)
      if (
        notifsRef.current && !notifsRef.current.contains(e.target as Node) &&
        (!notifDropdownRef.current || !notifDropdownRef.current.contains(e.target as Node))
      ) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  // ── Palette keyboard listener ──────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setShowPalette(v => !v) }
      if (e.key === 'Escape') setShowPalette(false)
      if (!showPalette) return
      if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteHi(h => h + 1) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setPaletteHi(h => Math.max(0, h - 1)) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showPalette])

  useEffect(() => {
    if (!showPalette) { setPaletteQuery(''); setPaletteHi(0); return }
    setTimeout(() => paletteInputRef.current?.focus(), 40)
    loadPaletteData()
  }, [showPalette])

  async function loadPaletteData() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch('/api/palette', { headers: { Authorization: `Bearer ${session.access_token}` } })
    if (res.ok) setPaletteData(await res.json())
  }

  async function paletteApprove(type: 'pto' | 'swap', id: number) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const url = type === 'pto' ? `/api/time-off/${id}` : `/api/shifts/swaps/${id}`
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ status: 'approved' }) })
    setPaletteData(prev => !prev ? prev : type === 'pto'
      ? { ...prev, ptos: prev.ptos.filter(p => p.id !== id) }
      : { ...prev, swaps: prev.swaps.filter(s => s.id !== id) })
  }

  async function paletteDeny(type: 'pto' | 'swap', id: number) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const url = type === 'pto' ? `/api/time-off/${id}` : `/api/shifts/swaps/${id}`
    await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ status: 'denied' }) })
    setPaletteData(prev => !prev ? prev : type === 'pto'
      ? { ...prev, ptos: prev.ptos.filter(p => p.id !== id) }
      : { ...prev, swaps: prev.swaps.filter(s => s.id !== id) })
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read).map(n => n.id)
    if (!unread.length) return
    await supabase.from('notifications').update({ read: true }).in('id', unread)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  // JAY-60 — clicking a notification now marks just that one read instead of
  // only being reachable via "mark all read". Fire-and-forget: the dropdown
  // closes and navigation happens immediately, no need to block on the write.
  function markOneRead(id: number) {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)))
    supabase.from('notifications').update({ read: true }).eq('id', id).then(() => {})
    setShowNotifs(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const emailInitials = userEmail ? userEmail.slice(0, 2).toUpperCase() : '??'
  const avatarText = displayName
    ? displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
    : emailInitials
  const unreadCount = notifications.filter(n => !n.read).length
  const pendingCount = unreadCount // shown as badge on dashboard if applicable

  const roleLabel = viewerRole === 'owner' ? 'Owner'
    : viewerRole === 'admin' ? 'Admin'
    : viewerRole === 'manager' ? 'Manager'
    : 'Employee'

  return (
    <>
    <div className="dash-nav">

      {/* ── Logo ── */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">H</div>
        <span className="sidebar-logo-text">Helpdesk</span>
      </div>

      {/* ── Search / Command palette ── */}
      <div style={{ padding: '8px 8px 4px' }}>
        <button
          onClick={() => setShowPalette(true)}
          style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 10px', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', color: '#64748b', fontSize: '12px', fontWeight: 400, transition: 'background 0.12s' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.09)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
        >
          <IconSearch />
          <span style={{ flex: 1, textAlign: 'left', color: '#475569' }}>Search…</span>
          <span style={{ display: 'flex', gap: '3px' }}>
            <span style={{ fontSize: '10px', color: '#334155', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', padding: '1px 4px', fontFamily: 'monospace' }}>⌘</span>
            <span style={{ fontSize: '10px', color: '#334155', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', padding: '1px 4px', fontFamily: 'monospace' }}>K</span>
          </span>
        </button>
      </div>

      {/* ── Nav items ── */}
      <div className="sidebar-nav-area">

        <div className="sidebar-section-label">Main</div>

        <a href="/" className={`sidebar-link${active === 'dashboard' ? ' active' : ''}`}>
          <span className="sidebar-link-icon"><IconDashboard /></span>
          Dashboard
          {pendingCount > 0 && active !== 'dashboard' && (
            <span className="sidebar-badge">{pendingCount}</span>
          )}
        </a>

        <a href="/time" className={`sidebar-link${active === 'time' ? ' active' : ''}`}>
          <span className="sidebar-link-icon"><IconTime /></span>
          Time
        </a>

        {canSeeHiring && (
          <a href="/hiring" className={`sidebar-link${active === 'hiring' ? ' active' : ''}`}>
            <span className="sidebar-link-icon"><IconHiring /></span>
            Hiring
          </a>
        )}

        {canSeePayroll && (
          <a href="/payroll" className={`sidebar-link${active === 'payroll' ? ' active' : ''}`}>
            <span className="sidebar-link-icon"><IconPayroll /></span>
            Payroll
          </a>
        )}

        {canSeePayroll && (
          <a href="/reports" className={`sidebar-link${active === 'reports' ? ' active' : ''}`}>
            <span className="sidebar-link-icon"><IconReports /></span>
            Reports
          </a>
        )}

        <div className="sidebar-section-label" style={{ marginTop: '12px' }}>Comms</div>

        <a href="/messages" className={`sidebar-link${active === 'messages' ? ' active' : ''}`}>
          <span className="sidebar-link-icon"><IconMessages /></span>
          Messages
          {unreadMessages > 0 && (
            <span className="sidebar-badge sidebar-badge-msg">{unreadMessages}</span>
          )}
        </a>

        <a href="/activity" className={`sidebar-link${active === 'activity' ? ' active' : ''}`}>
          <span className="sidebar-link-icon"><IconActivity /></span>
          Activity
        </a>

      </div>

      {/* ── Trial banner ── */}
      {trialBanner && (
        <div style={{ margin: '0 8px 8px', padding: '8px 10px', borderRadius: '8px', background: trialBanner.status === 'trialing' ? 'rgba(234,179,8,0.12)' : 'rgba(220,38,38,0.12)', border: `1px solid ${trialBanner.status === 'trialing' ? 'rgba(234,179,8,0.25)' : 'rgba(220,38,38,0.25)'}` }}>
          <div style={{ fontSize: '11px', color: trialBanner.status === 'trialing' ? '#fbbf24' : '#f87171', lineHeight: 1.4 }}>
            {trialBanner.status === 'trialing'
              ? `Trial ends in ${trialBanner.daysLeft}d`
              : trialBanner.status === 'past_due' ? 'Payment failed' : 'Subscription ended'}
          </div>
          <a href="/settings?tab=billing" style={{ fontSize: '11px', color: '#60a5fa', fontWeight: 600, textDecoration: 'none' }}>
            {trialBanner.status === 'trialing' ? 'Choose plan →' : 'Fix billing →'}
          </a>
        </div>
      )}

      {/* ── Bottom: notifications + user ── */}
      <div className="sidebar-bottom">

        {/* Notification bell row */}
        <div ref={notifsRef} style={{ position: 'relative' }}>
          <button
            onClick={() => {
              if (!showNotifs && notifsRef.current) {
                const rect = notifsRef.current.getBoundingClientRect()
                setNotifPos({ left: rect.left, bottom: window.innerHeight - rect.top + 8 })
                markAllRead()
              }
              setShowNotifs(v => !v)
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '7px 8px', borderRadius: '7px', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '12px', fontWeight: 500, position: 'relative', marginBottom: '2px', transition: 'background 0.12s' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <IconBell />
              {unreadCount > 0 && (
                <span className="notif-badge" style={{ top: '-5px', right: '-6px' }}>{unreadCount}</span>
              )}
            </div>
            Notifications
          </button>
        </div>

        {/* User row */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <div className="sidebar-user" onClick={() => setShowMenu(v => !v)}>
            <div className="sidebar-user-avatar">{avatarText}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="sidebar-user-name">{displayName || userEmail}</div>
              <div className="sidebar-user-role">{roleLabel}</div>
            </div>
            {canSeeSettings && (
              <a href="/settings" className="sidebar-gear" onClick={e => e.stopPropagation()}>
                <SettingsIcon size={14} color="currentColor" />
              </a>
            )}
          </div>

          {showMenu && (
            <div className="user-menu">
              <div className="user-menu-header">
                <div className="user-menu-email">{userEmail}</div>
              </div>
              <div className="user-menu-items">
                {canSeeSettings && (
                  <a href="/settings" className="user-menu-item">
                    <SettingsIcon size={14} color="currentColor" /> Settings
                  </a>
                )}
                <div className="user-menu-divider" />
                <div className="user-menu-item user-menu-signout" onClick={handleLogout}>
                  <SignOutIcon size={14} color="currentColor" /> Sign out
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>

    {/* ── Notifications dropdown ──────────────────────────────────────────────
        Rendered as a sibling of .dash-nav (not nested inside it) and positioned
        with `fixed` + coordinates computed from the bell button. The sidebar
        (.dash-nav) has overflow-y: auto, which per the CSS overflow spec forces
        overflow-x to also become a clipping/scroll container — so a dropdown
        wider than the 240px sidebar and nested inside it gets its right edge
        cut off. Escaping the sidebar's DOM subtree avoids that entirely. */}
    {showNotifs && notifPos && (
      <div ref={notifDropdownRef} className="notif-dropdown" style={{ position: 'fixed', left: notifPos.left, bottom: notifPos.bottom }}>
        <div className="notif-header">Notifications</div>
        {notifications.length === 0 ? (
          <div className="notif-empty">No notifications yet.</div>
        ) : notifications.map(n => (
          // JAY-60 — every notification is now a real link when the insert
          // site provided one, matching the Linear/Slack pattern of clicking
          // through to the thing referenced instead of a dead-end text row.
          // Older rows (or insert sites not yet updated) have no `link`, so
          // they fall back to the old plain, non-navigating row.
          n.link ? (
            <a key={n.id} href={n.link} className={`notif-item${n.read ? '' : ' unread'}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }} onClick={() => markOneRead(n.id)}>
              <div className="notif-msg">{n.message}</div>
              <div className="notif-time">{timeAgo(n.created_at)}</div>
            </a>
          ) : (
            <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`} style={{ cursor: n.read ? 'default' : 'pointer' }} onClick={() => !n.read && markOneRead(n.id)}>
              <div className="notif-msg">{n.message}</div>
              <div className="notif-time">{timeAgo(n.created_at)}</div>
            </div>
          )
        ))}
        <a href="/notifications" className="notif-footer">View all notifications →</a>
      </div>
    )}

    {/* ── Command Palette ─────────────────────────────────────────────────── */}
    {showPalette && (() => {
      const q = paletteQuery.toLowerCase()
      const ptos     = (paletteData?.ptos      ?? []).filter(p => !q || p.employeeName.toLowerCase().includes(q))
      const swaps    = (paletteData?.swaps     ?? []).filter(s => !q || s.requesterName.toLowerCase().includes(q))
      const callouts = (paletteData?.callouts  ?? []).filter(c => !q || c.employeeName.toLowerCase().includes(q))
      const emps     = (paletteData?.employees ?? []).filter(e => !q || e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q)).slice(0, 5)
      const quickActions = [
        { label: 'Add shift',          sub: 'Schedule an employee for a new shift', href: '/time' },
        { label: 'Post announcement',  sub: 'Send a message to all employees',      href: '/' },
        { label: 'Add employee',       sub: 'Onboard a new team member',            href: '/' },
        { label: 'View timesheets',    sub: 'See who is clocked in right now',      href: '/time' },
      ].filter(a => !q || a.label.toLowerCase().includes(q) || a.sub.toLowerCase().includes(q))

      const hasAttention = ptos.length > 0 || swaps.length > 0 || callouts.length > 0

      const rowStyle = (hi: boolean): React.CSSProperties => ({
        display: 'flex', alignItems: 'center', gap: '11px', padding: '9px 14px', margin: '1px 4px',
        borderRadius: '8px', cursor: 'pointer',
        background: hi ? 'rgba(29,78,216,0.2)' : 'transparent',
        transition: 'background 0.08s',
      })
      const iconBox = (color: string): React.CSSProperties => ({
        width: 28, height: 28, borderRadius: '7px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: color,
      })
      const badgeStyle = (color: 'red' | 'amber' | 'green'): React.CSSProperties => {
        const map = { red: ['rgba(239,68,68,0.15)','#f87171'], amber: ['rgba(245,158,11,0.15)','#fbbf24'], green: ['rgba(34,197,94,0.15)','#4ade80'] }
        return { fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '99px', background: map[color][0], color: map[color][1] }
      }

      let rowIdx = 0

      return (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', backdropFilter: 'blur(4px)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '80px' }}
          onClick={() => setShowPalette(false)}
        >
          <div
            style={{ width: '520px', maxWidth: 'calc(100vw - 32px)', background: '#1a2236', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.7)', maxHeight: 'calc(100vh - 160px)', display: 'flex', flexDirection: 'column' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ color: '#475569', flexShrink: 0 }}><IconSearch /></span>
              <input
                ref={paletteInputRef}
                value={paletteQuery}
                onChange={e => { setPaletteQuery(e.target.value); setPaletteHi(0) }}
                placeholder="Search employees, actions…"
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: '14px', color: '#f1f5f9', fontFamily: 'inherit', caretColor: '#3b82f6' }}
              />
              <span style={{ fontSize: '11px', color: '#475569', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', padding: '2px 6px', fontFamily: 'monospace', cursor: 'pointer' }} onClick={() => setShowPalette(false)}>esc</span>
            </div>

            {/* Results */}
            <div style={{ overflowY: 'auto', flex: 1 }}>

              {/* Needs attention */}
              {hasAttention && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '.08em', padding: '10px 16px 4px' }}>Needs your attention</div>

                  {ptos.map(p => { const hi = paletteHi % Math.max(1, (ptos.length + swaps.length + callouts.length + quickActions.length + emps.length)) === rowIdx++; return (
                    <div key={`pto-${p.id}`} style={rowStyle(hi)} onMouseEnter={() => setPaletteHi(rowIdx - 1)}>
                      <div style={iconBox('rgba(34,197,94,0.15)')}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: '#e2e8f0' }}>Approve {p.employeeName}&apos;s {p.type}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>{fmtShort(p.start_date)} – {fmtShort(p.end_date)}{p.reason ? ` · ${p.reason}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                        <button onClick={() => paletteApprove('pto', p.id)} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(34,197,94,0.15)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.25)', cursor: 'pointer', fontFamily: 'inherit' }}>Approve</button>
                        <button onClick={() => paletteDeny('pto', p.id)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontFamily: 'inherit' }}>Deny</button>
                      </div>
                    </div>
                  )})}

                  {swaps.map(s => { const hi = paletteHi % Math.max(1, (ptos.length + swaps.length + callouts.length + quickActions.length + emps.length)) === rowIdx++; return (
                    <div key={`swap-${s.id}`} style={rowStyle(hi)} onMouseEnter={() => setPaletteHi(rowIdx - 1)}>
                      <div style={iconBox('rgba(59,130,246,0.15)')}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2"><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', color: '#e2e8f0' }}>Shift swap — {s.requesterName}{s.targetName ? ` → ${s.targetName}` : ''}</div>
                        {s.notes && <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>&ldquo;{s.notes}&rdquo;</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                        <button onClick={() => paletteApprove('swap', s.id)} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)', cursor: 'pointer', fontFamily: 'inherit' }}>Approve</button>
                        <button onClick={() => paletteDeny('swap', s.id)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', fontFamily: 'inherit' }}>Deny</button>
                      </div>
                    </div>
                  )})}

                  {callouts.map(c => { const hi = paletteHi % Math.max(1, (ptos.length + swaps.length + callouts.length + quickActions.length + emps.length)) === rowIdx++; return (
                    <div key={`co-${c.id}`} style={rowStyle(hi)} onMouseEnter={() => setPaletteHi(rowIdx - 1)}>
                      <div style={iconBox('rgba(239,68,68,0.15)')}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{c.employeeName} called out</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>{fmt12(c.start_time)} – {fmt12(c.end_time)} · coverage gap</div>
                      </div>
                      <span style={badgeStyle('red')}>urgent</span>
                    </div>
                  )})}
                </>
              )}

              {/* Quick actions */}
              {quickActions.length > 0 && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '.08em', padding: '10px 16px 4px' }}>Quick actions</div>
                  {quickActions.map(a => { const hi = paletteHi % Math.max(1, (ptos.length + swaps.length + callouts.length + quickActions.length + emps.length)) === rowIdx++; return (
                    <a key={a.label} href={a.href} style={{ ...rowStyle(hi), textDecoration: 'none' }} onClick={() => setShowPalette(false)} onMouseEnter={() => setPaletteHi(rowIdx - 1)}>
                      <div style={iconBox('rgba(100,116,139,0.12)')}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{a.label}</div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>{a.sub}</div>
                      </div>
                    </a>
                  )})}
                </>
              )}

              {/* Employees */}
              {emps.length > 0 && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '.08em', padding: '10px 16px 4px' }}>Jump to employee</div>
                  {emps.map(e => { const hi = paletteHi % Math.max(1, (ptos.length + swaps.length + callouts.length + quickActions.length + emps.length)) === rowIdx++; return (
                    <a key={e.id} href="/" style={{ ...rowStyle(hi), textDecoration: 'none' }} onClick={() => setShowPalette(false)} onMouseEnter={() => setPaletteHi(rowIdx - 1)}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(100,116,139,0.15)', color: '#94a3b8', fontSize: '11px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {e.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{e.name}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{e.role}</div>
                      </div>
                    </a>
                  )})}
                </>
              )}

              {!paletteData && (
                <div style={{ textAlign: 'center', padding: '1.5rem', fontSize: '13px', color: '#475569' }}>Loading…</div>
              )}
              {paletteData && !hasAttention && quickActions.length === 0 && emps.length === 0 && (
                <div style={{ textAlign: 'center', padding: '1.5rem', fontSize: '13px', color: '#475569' }}>No results for &ldquo;{paletteQuery}&rdquo;</div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: '14px' }}>
              {[['↑↓','navigate'],['↵','select'],['esc','close']].map(([k,v]) => (
                <span key={k} style={{ fontSize: '11px', color: '#475569', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '3px', padding: '1px 5px', fontFamily: 'monospace', fontSize: '10px' }}>{k}</span> {v}
                </span>
              ))}
            </div>
          </div>
        </div>
      )
    })()}
    </>
  )
}
