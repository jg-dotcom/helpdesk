'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { BellIcon } from './Icons'

type Props = {
  active: 'dashboard' | 'payroll' | 'schedule' | 'timesheet' | 'jobs' | 'integrations' | 'settings'
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

export default function Nav({ active }: Props) {
  const [userEmail, setUserEmail] = useState('')
  const [showMenu, setShowMenu] = useState(false)
  const [showNotifs, setShowNotifs] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const notifsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) return
      setUserEmail(session.user.email ?? '')

      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20)
        .then(({ data }) => { if (data) setNotifications(data) })

      // Realtime: push new notifications as they arrive
      channel = supabase
        .channel(`notifications:${session.user.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${session.user.id}`,
        }, payload => {
          setNotifications(prev => [payload.new as Notification, ...prev].slice(0, 20))
        })
        .subscribe()
    })

    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false)
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

  const initials = userEmail ? userEmail.slice(0, 2).toUpperCase() : '??'
  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="dash-nav">
      <div className="dash-nav-left">
        <div className="logo">help<span>desk</span></div>
        <nav className="dash-nav-links">
          <a href="/" className={`dash-nav-link${active === 'dashboard' ? ' active' : ''}`}>Dashboard</a>
          <a href="/payroll" className={`dash-nav-link${active === 'payroll' ? ' active' : ''}`}>Payroll</a>
          <a href="/schedule" className={`dash-nav-link${active === 'schedule' ? ' active' : ''}`}>Schedule</a>
          <a href="/timesheet" className={`dash-nav-link${active === 'timesheet' ? ' active' : ''}`}>Timesheets</a>
          <a href="/jobs" className={`dash-nav-link${active === 'jobs' ? ' active' : ''}`}>Jobs</a>
          <a href="/integrations" className={`dash-nav-link${active === 'integrations' ? ' active' : ''}`}>Integrations</a>
        </nav>
      </div>

      <div className="dash-nav-right">
        {/* Bell */}
        <div className="notif-wrap" ref={notifsRef}>
          <button
            className="notif-bell"
            onClick={() => { setShowNotifs(v => !v); if (!showNotifs) markAllRead() }}
          >
            <BellIcon size={18} color="currentColor" />
            {unreadCount > 0 && <span className="notif-badge">{unreadCount}</span>}
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

        {/* Avatar */}
        <div ref={menuRef} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          <div className="user-avatar" onClick={() => setShowMenu(v => !v)}>{initials}</div>
          {showMenu && (
            <div className="user-menu">
              <div className="user-menu-header">
                <div className="user-menu-email">{userEmail}</div>
              </div>
              <div className="user-menu-items">
                <a href="/settings" className="user-menu-item">⚙ Settings</a>
                <div className="user-menu-divider" />
                <div className="user-menu-item user-menu-signout" onClick={handleLogout}>→ Sign out</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
