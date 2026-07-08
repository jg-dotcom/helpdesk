'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { SettingsIcon, SignOutIcon } from './Icons'

type Props = {
  active: 'dashboard' | 'time' | 'hiring' | 'payroll' | 'reports' | 'settings' | 'messages'
  viewerRole?: 'owner' | 'admin' | 'manager' | 'employee'
  viewerPerms?: Record<string, boolean> | null
}

type Notification = { id: number; message: string; created_at: string; read: boolean }

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
  const menuRef   = useRef<HTMLDivElement>(null)
  const notifsRef = useRef<HTMLDivElement>(null)

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
      if (notifsRef.current && !notifsRef.current.contains(e.target as Node)) setShowNotifs(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read).map(n => n.id)
    if (!unread.length) return
    await supabase.from('notifications').update({ read: true }).in('id', unread)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
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
    <div className="dash-nav">

      {/* ── Logo ── */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">H</div>
        <span className="sidebar-logo-text">Helpdesk</span>
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

        <a href="#" className="sidebar-link" style={{ opacity: 0.5, pointerEvents: 'none' }}>
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
            onClick={() => { setShowNotifs(v => !v); if (!showNotifs) markAllRead() }}
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

          {showNotifs && (
            <div className="notif-dropdown">
              <div className="notif-header">Notifications</div>
              {notifications.length === 0 ? (
                <div className="notif-empty">No notifications yet.</div>
              ) : notifications.map(n => (
                <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`}>
                  <div className="notif-msg">{n.message}</div>
                  <div className="notif-time">{timeAgo(n.created_at)}</div>
                </div>
              ))}
            </div>
          )}
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
  )
}
