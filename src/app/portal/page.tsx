'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import OnboardingFlow from '../sign/[token]/OnboardingFlow'

type Employee = { id: number; name: string; role: string; email: string }
type Shift = { id: number; shift_date: string; start_time: string; end_time: string; notes: string | null; status?: string }
type OpenShift = { id: number; shift_date: string; start_time: string; end_time: string; notes: string | null }
type CoworkerShift = { id: number; employee_id: number; employee_name: string; shift_date: string; start_time: string; end_time: string }
type SwapRequest = { id: number; requester_shift_id: number; target_shift_id: number | null; target_employee_id: number | null; status: string; notes: string | null; created_at: string }
type TimeEntry = { id: number; clock_in: string; clock_out: string | null; total_minutes: number | null }
type TimeOffRequest = { id: number; start_date: string; end_date: string; type: string; reason: string | null; status: string }
type PTOBalance = { total: number; used: number; remaining: number }

function fmt(t: string) {
  const [h, m] = t.split(':'); const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`
}
function fmtDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
function elapsed(clockIn: string) {
  const mins = Math.floor((Date.now() - new Date(clockIn).getTime()) / 60000)
  const h = Math.floor(mins / 60); const m = mins % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
function weekStartISO() {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); d.setHours(0, 0, 0, 0); return d.toISOString()
}

export default function PortalPage() {
  const [token, setToken] = useState('')
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [shifts, setShifts] = useState<Shift[]>([])
  const [openShifts, setOpenShifts] = useState<OpenShift[]>([])
  const [swapRequests, setSwapRequests] = useState<SwapRequest[]>([])
  const [coworkerShifts, setCoworkerShifts] = useState<CoworkerShift[]>([])
  const [currentEntry, setCurrentEntry] = useState<TimeEntry | null>(null)
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([])
  const [ptoBalance, setPtoBalance] = useState<PTOBalance | null>(null)
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [clockLoading, setClockLoading] = useState(false)
  const [clockMsg, setClockMsg] = useState('')
  const [ticker, setTicker] = useState(0)

  // PTO form
  const [showTOForm, setShowTOForm] = useState(false)
  const [toStart, setToStart] = useState('')
  const [toEnd, setToEnd] = useState('')
  const [toType, setToType] = useState('PTO')
  const [toReason, setToReason] = useState('')
  const [toSaving, setToSaving] = useState(false)
  const [toMsg, setToMsg] = useState('')

  // Swap form
  const [swapShiftId, setSwapShiftId] = useState<number | null>(null)
  const [swapTargetShiftId, setSwapTargetShiftId] = useState<number | ''>('')
  const [swapNotes, setSwapNotes] = useState('')
  const [swapSaving, setSwapSaving] = useState(false)
  const [swapMsg, setSwapMsg] = useState('')

  // Claim open shift
  const [claimingId, setClaimingId] = useState<number | null>(null)

  // Messages
  const [activeTab, setActiveTab] = useState<'home' | 'messages'>('home')
  const [chatBusinessId, setChatBusinessId] = useState('')
  const [chatChannels, setChatChannels] = useState<{ id: string; name: string; type: 'group' | 'dm'; unreadCount: number; lastMessage: { sender_name: string; content: string; created_at: string } | null }[]>([])
  const [activeChatChannel, setActiveChatChannel] = useState<{ id: string; name: string; type: 'group' | 'dm' } | null>(null)
  const [chatMessages, setChatMessages] = useState<{ id: number; sender_id: string; sender_name: string; content: string; created_at: string }[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [chatLoadingThread, setChatLoadingThread] = useState(false)
  const [chatUserId, setChatUserId] = useState('')
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const [unreadMessages, setUnreadMessages] = useState(0)

  // Pending onboarding
  const [onboardingToken, setOnboardingToken] = useState<string | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingData, setOnboardingData] = useState<{ token: string; employeeId: number; userId: string; employeeName: string; welcomePack: string | null; docs: { id: number; file_name: string; file_size: number; url: string | null }[] } | null>(null)
  const [onboardingLoading, setOnboardingLoading] = useState(false)

  // Bell / notifications
  const [showBell, setShowBell] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setToken(session.access_token)
      setChatUserId(session.user.id)
      await loadAll(session.access_token)
    })
    const t = setInterval(() => setTicker(n => n + 1), 60000)

    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBell(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => { clearInterval(t); document.removeEventListener('mousedown', handleClick) }
  }, [])

  async function loadAll(tk: string) {
    const headers = { Authorization: `Bearer ${tk}` }
    const [meRes, shiftsRes, ptoRes, toRes, entriesRes, openRes, swapRes, coworkerRes, onboardRes] = await Promise.all([
      fetch('/api/employee/me', { headers }),
      fetch('/api/employee/shifts', { headers }),
      fetch('/api/employee/pto-balance', { headers }),
      fetch('/api/employee/time-off', { headers }),
      fetch('/api/employee/time-entries', { headers }),
      fetch('/api/employee/open-shifts', { headers }),
      fetch('/api/employee/swap-requests', { headers }),
      fetch('/api/employee/coworker-shifts', { headers }),
      fetch('/api/portal/onboarding-check', { headers }),
    ])
    const [me, sh, pto, to, ents, open, swaps, coworkers, onboard] = await Promise.all([
      meRes.json(), shiftsRes.json(), ptoRes.json(), toRes.json(), entriesRes.json(),
      openRes.json(), swapRes.json(), coworkerRes.json(), onboardRes.json(),
    ])

    if (!me.employee) { window.location.href = '/'; return }

    setEmployee(me.employee)
    if (onboard?.token) {
      setOnboardingToken(onboard.token)
      // Auto-open once per session
      if (!sessionStorage.getItem('onboarding_shown')) {
        const dataRes = await fetch(`/api/portal/onboarding-data?token=${onboard.token}`, { headers })
        const dataJson = await dataRes.json()
        if (dataRes.ok) { setOnboardingData(dataJson); setShowOnboarding(true) }
      }
    }
    setShifts(sh.shifts ?? [])
    setOpenShifts(open.shifts ?? [])
    setSwapRequests(swaps.swaps ?? [])
    setCoworkerShifts(coworkers.shifts ?? [])
    setPtoBalance(pto.balance)
    setTimeOffRequests(to.requests ?? [])

    const allEntries: TimeEntry[] = ents.entries ?? []
    setCurrentEntry(allEntries.find(e => !e.clock_out) ?? null)
    setWeekEntries(allEntries.filter(e => e.clock_out))
    setLoading(false)

    // Load chat channels
    const chatRes = await fetch('/api/messages/channels', { headers })
    const chatData = await chatRes.json()
    if (chatRes.ok && chatData.channels) {
      setChatBusinessId(chatData.businessId)
      setChatChannels(chatData.channels)
      const total = chatData.channels.reduce((s: number, c: { unreadCount: number }) => s + c.unreadCount, 0)
      setUnreadMessages(total)
    }
  }

  // Realtime: subscribe to new chat messages
  useEffect(() => {
    if (!chatBusinessId || !chatUserId) return
    const sub = supabase
      .channel(`chat:portal:${chatBusinessId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `business_id=eq.${chatBusinessId}`,
      }, (payload) => {
        const msg = payload.new as { id: number; sender_id: string; sender_name: string; content: string; created_at: string; channel: string }
        // Add to thread if viewing that channel
        setActiveChatChannel(ch => {
          if (ch?.id === msg.channel) {
            setChatMessages(prev => [...prev, msg])
            setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
          }
          return ch
        })
        // Update channel list
        setChatChannels(prev => prev.map(c => {
          if (c.id === msg.channel) {
            const isViewing = activeChatChannel?.id === msg.channel
            return {
              ...c,
              lastMessage: { sender_name: msg.sender_name, content: msg.content, created_at: msg.created_at },
              unreadCount: (msg.sender_id !== chatUserId && !isViewing) ? c.unreadCount + 1 : c.unreadCount,
            }
          }
          return c
        }))
        if (msg.sender_id !== chatUserId) setUnreadMessages(prev => prev + 1)
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [chatBusinessId, chatUserId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function openOnboarding() {
    if (!onboardingToken || !token) return
    if (onboardingData) { setShowOnboarding(true); return }
    setOnboardingLoading(true)
    const res = await fetch(`/api/portal/onboarding-data?token=${onboardingToken}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (res.ok) { setOnboardingData(data); setShowOnboarding(true) }
    setOnboardingLoading(false)
  }

  async function openChatChannel(ch: typeof chatChannels[0]) {
    setActiveChatChannel(ch)
    setChatLoadingThread(true)
    setChatMessages([])
    const res = await fetch(`/api/messages/thread?channel=${ch.id}&businessId=${chatBusinessId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await res.json()
    if (res.ok) setChatMessages(data.messages)
    setChatLoadingThread(false)
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'auto' }), 80)
    if (ch.unreadCount > 0) {
      fetch('/api/messages/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: ch.id, businessId: chatBusinessId }),
      })
      setChatChannels(prev => prev.map(c => c.id === ch.id ? { ...c, unreadCount: 0 } : c))
      setUnreadMessages(prev => Math.max(0, prev - ch.unreadCount))
    }
  }

  async function sendChatMessage() {
    const content = chatInput.trim()
    if (!content || chatSending || !activeChatChannel) return
    setChatInput('')
    setChatSending(true)
    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: activeChatChannel.id, businessId: chatBusinessId, content }),
    })
    const data = await res.json()
    if (res.ok) {
      setChatMessages(prev => [...prev, data.message])
      setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      setChatChannels(prev => prev.map(c =>
        c.id === activeChatChannel.id
          ? { ...c, lastMessage: { sender_name: data.message.sender_name, content: data.message.content, created_at: data.message.created_at } }
          : c
      ))
    }
    setChatSending(false)
    setTimeout(() => chatInputRef.current?.focus(), 50)
  }

  async function clockIn() {
    setClockLoading(true); setClockMsg('')
    const res = await fetch('/api/employee/clock-in', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (res.ok) { setCurrentEntry(data.entry); setClockMsg('Clocked in!') }
    else setClockMsg(data.error ?? 'Error')
    setClockLoading(false); setTimeout(() => setClockMsg(''), 3000)
  }

  async function clockOut() {
    setClockLoading(true); setClockMsg('')
    const res = await fetch('/api/employee/clock-out', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (res.ok) {
      setWeekEntries(prev => [...prev, { ...currentEntry!, clock_out: data.entry.clock_out, total_minutes: data.entry.total_minutes }])
      setCurrentEntry(null); setClockMsg('Clocked out.')
    } else setClockMsg(data.error ?? 'Error')
    setClockLoading(false); setTimeout(() => setClockMsg(''), 3000)
  }

  async function submitTimeOff() {
    if (!toStart || !toEnd) return
    setToSaving(true); setToMsg('')
    const res = await fetch('/api/employee/time-off', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ startDate: toStart, endDate: toEnd, type: toType, reason: toReason }),
    })
    if (res.ok) {
      setToMsg('Request submitted.'); setToStart(''); setToEnd(''); setToReason(''); setShowTOForm(false)
      const toRes = await fetch('/api/employee/time-off', { headers: { Authorization: `Bearer ${token}` } })
      const toData = await toRes.json(); setTimeOffRequests(toData.requests ?? [])
    } else {
      const data = await res.json(); setToMsg(data.error ?? 'Error')
    }
    setToSaving(false); setTimeout(() => setToMsg(''), 4000)
  }

  async function claimShift(shiftId: number) {
    setClaimingId(shiftId)
    const res = await fetch('/api/employee/claim-shift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ shiftId }),
    })
    const data = await res.json()
    if (res.ok) {
      setOpenShifts(prev => prev.filter(s => s.id !== shiftId))
      const claimed = openShifts.find(s => s.id === shiftId)
      if (claimed) setShifts(prev => [...prev, { ...claimed, status: undefined }].sort((a, b) => a.shift_date.localeCompare(b.shift_date)))
    } else {
      alert(data.error ?? 'Could not claim shift.')
    }
    setClaimingId(null)
  }

  async function submitSwapRequest() {
    if (!swapShiftId) return
    setSwapSaving(true); setSwapMsg('')
    const res = await fetch('/api/employee/swap-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        requesterShiftId: swapShiftId,
        targetShiftId: swapTargetShiftId || null,
        targetEmployeeId: swapTargetShiftId ? (coworkerShifts.find(s => s.id === Number(swapTargetShiftId))?.employee_id ?? null) : null,
        notes: swapNotes,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      setSwapMsg('Swap request sent!')
      setSwapShiftId(null); setSwapTargetShiftId(''); setSwapNotes('')
      setSwapRequests(prev => [data.swap, ...prev])
    } else {
      setSwapMsg(data.error ?? 'Error')
    }
    setSwapSaving(false); setTimeout(() => setSwapMsg(''), 3000)
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const today = new Date().toISOString().slice(0, 10)
  const todayShift = shifts.find(s => s.shift_date === today && s.status !== 'called_out')
  const upcomingShifts = shifts.filter(s => s.shift_date > today)
  const weeklyMins = weekEntries.reduce((s, e) => s + (e.total_minutes ?? 0), 0)
  const weeklyHrs = Math.floor(weeklyMins / 60)
  const weeklyMinsRem = weeklyMins % 60
  const statusColor = { approved: '#27ae60', denied: '#c0392b', pending: '#e67e22' }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', background: '#f5f6fa' }}>
      <div style={{ color: '#999', fontSize: '14px' }}>Loading...</div>
    </div>
  )

  const initials = employee?.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '0 2rem', height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: '18px', fontWeight: 800, letterSpacing: '-0.5px' }}>help<span style={{ color: '#185fa5' }}>desk</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>

          {/* Tab nav */}
          <div style={{ display: 'flex', gap: '2px', background: '#f0f2f5', borderRadius: '8px', padding: '3px' }}>
            {(['home', 'messages'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab)
                  if (tab === 'messages' && chatChannels.length > 0 && !activeChatChannel) {
                    openChatChannel(chatChannels[0])
                  }
                }}
                style={{
                  padding: '5px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
                  border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                  background: activeTab === tab ? '#fff' : 'transparent',
                  color: activeTab === tab ? '#1a1a1a' : '#888',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
              >
                {tab === 'home' ? 'Home' : 'Messages'}
                {tab === 'messages' && unreadMessages > 0 && (
                  <span style={{ position: 'absolute', top: '1px', right: '1px', width: 8, height: 8, borderRadius: '50%', background: '#185fa5' }} />
                )}
              </button>
            ))}
          </div>

          {/* Bell */}
          <div ref={bellRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setShowBell(v => !v)}
              style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: '4px', display: 'flex', alignItems: 'center' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
              {onboardingToken && <span style={{ position: 'absolute', top: 2, right: 2, width: 8, height: 8, borderRadius: '50%', background: '#c0392b', border: '1.5px solid #fff' }} />}
            </button>
            {showBell && (
              <div style={{ position: 'absolute', right: 0, top: '120%', width: 280, background: '#fff', borderRadius: '10px', border: '1px solid #eee', boxShadow: '0 4px 16px rgba(0,0,0,0.1)', zIndex: 100 }}>
                <div style={{ padding: '10px 14px', borderBottom: '1px solid #f0f0f0', fontSize: '12px', fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notifications</div>
                {onboardingToken ? (
                  <div
                    onClick={() => { setShowBell(false); openOnboarding() }}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px', cursor: 'pointer', borderBottom: '1px solid #f5f5f5' }}
                  >
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#185fa5', flexShrink: 0, marginTop: 5 }} />
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>Complete your onboarding</div>
                      <div style={{ fontSize: '12px', color: '#999', marginTop: '2px' }}>W-4, I-9, direct deposit, and more.</div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '16px 14px', fontSize: '13px', color: '#bbb' }}>No new notifications.</div>
                )}
              </div>
            )}
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#1a1a1a' }}>{employee?.name}</div>
            <div style={{ fontSize: '11px', color: '#999' }}>{employee?.role}</div>
          </div>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#185fa5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 700, flexShrink: 0 }}>
            {initials}
          </div>
          <button onClick={signOut} style={{ fontSize: '12px', color: '#aaa', background: 'none', border: '1px solid #e5e5e5', borderRadius: '6px', cursor: 'pointer', padding: '5px 10px' }}>Sign out</button>
        </div>
      </div>

      {/* Messages tab */}
      {activeTab === 'messages' && (
        <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
          {/* Channel sidebar */}
          <div style={{ width: '240px', flexShrink: 0, background: '#fff', borderRight: '0.5px solid #eee', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1rem 0.5rem', borderBottom: '0.5px solid #f0f0f0' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1a1a' }}>Messages</div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {chatChannels.map(ch => (
                <div
                  key={ch.id}
                  onClick={() => openChatChannel(ch)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
                    cursor: 'pointer',
                    background: activeChatChannel?.id === ch.id ? '#f0f6ff' : 'transparent',
                    borderLeft: `3px solid ${activeChatChannel?.id === ch.id ? '#185fa5' : 'transparent'}`,
                  }}
                >
                  <div style={{
                    width: 34, height: 34, borderRadius: ch.type === 'group' ? '8px' : '50%',
                    background: ch.type === 'group' ? '#185fa5' : '#e8f0fe',
                    color: ch.type === 'group' ? '#fff' : '#185fa5',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: ch.type === 'group' ? '14px' : '11px', fontWeight: 700, flexShrink: 0,
                  }}>
                    {ch.type === 'group'
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      : ch.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: ch.unreadCount > 0 ? 700 : 500, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.name}
                    </div>
                    {ch.lastMessage && (
                      <div style={{ fontSize: '11px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ch.lastMessage.content}
                      </div>
                    )}
                  </div>
                  {ch.unreadCount > 0 && (
                    <div style={{ minWidth: 18, height: 18, borderRadius: '99px', background: '#185fa5', color: '#fff', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', flexShrink: 0 }}>
                      {ch.unreadCount}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Thread */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {activeChatChannel && (
              <div style={{ background: '#fff', borderBottom: '0.5px solid #eee', padding: '0 1.25rem', height: '52px', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{activeChatChannel.name}</div>
                <div style={{ fontSize: '12px', color: '#999' }}>{activeChatChannel.type === 'group' ? 'Team chat' : 'Direct message'}</div>
              </div>
            )}

            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
              {chatLoadingThread ? (
                <div style={{ textAlign: 'center', color: '#bbb', fontSize: '13px', paddingTop: '2rem' }}>Loading…</div>
              ) : chatMessages.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#bbb', fontSize: '13px', paddingTop: '4rem' }}>No messages yet.</div>
              ) : chatMessages.map((msg, i) => {
                const isMe = msg.sender_id === chatUserId
                const prevMsg = chatMessages[i - 1]
                const showName = !isMe && prevMsg?.sender_id !== msg.sender_id

                return (
                  <div key={msg.id} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: '5px', marginTop: showName ? '10px' : 0 }}>
                    {!isMe && (
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#e8f0fe', color: '#185fa5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700, flexShrink: 0, marginRight: '8px', alignSelf: 'flex-end', opacity: showName ? 1 : 0 }}>
                        {msg.sender_name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div style={{ maxWidth: '72%' }}>
                      {showName && <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, marginBottom: '3px', marginLeft: '2px' }}>{msg.sender_name}</div>}
                      <div style={{
                        padding: '8px 12px',
                        borderRadius: isMe ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                        background: isMe ? '#185fa5' : '#fff',
                        color: isMe ? '#fff' : '#1a1a1a',
                        fontSize: '14px', lineHeight: 1.5,
                        border: isMe ? 'none' : '0.5px solid #e8eaed',
                        wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={chatBottomRef} />
            </div>

            {activeChatChannel && (
              <div style={{ background: '#fff', borderTop: '0.5px solid #eee', padding: '0.75rem 1.25rem', flexShrink: 0 }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', background: '#f5f6fa', borderRadius: '10px', padding: '7px 10px', border: '0.5px solid #eee' }}>
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage() } }}
                    placeholder={`Message ${activeChatChannel.name}…`}
                    rows={1}
                    disabled={chatSending}
                    style={{ flex: 1, resize: 'none', fontSize: '14px', padding: '3px 2px', border: 'none', background: 'transparent', fontFamily: 'inherit', outline: 'none', lineHeight: 1.5, maxHeight: '80px', overflowY: 'auto', color: '#1a1a1a' }}
                    onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 80)}px` }}
                  />
                  <button
                    onClick={sendChatMessage}
                    disabled={chatSending || !chatInput.trim()}
                    style={{ width: 32, height: 32, borderRadius: '7px', border: 'none', flexShrink: 0, background: chatInput.trim() && !chatSending ? '#185fa5' : '#dde1ea', color: '#fff', cursor: chatInput.trim() && !chatSending ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Page body */}
      {activeTab === 'home' && <div style={{ maxWidth: '1120px', margin: '0 auto', padding: '2rem 1.5rem' }}>

        {/* Greeting row */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontSize: '22px', fontWeight: 700, color: '#1a1a1a' }}>
            {greeting()}, {employee?.name.split(' ')[0]}
          </div>
          <div style={{ fontSize: '13px', color: '#999', marginTop: '3px' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>

        {/* Onboarding banner */}
        {onboardingToken && (
          <div
            onClick={openOnboarding}
            style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: '#f0f6ff', border: '1px solid #c5dcf7', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1.5rem', cursor: 'pointer' }}
          >
            <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#185fa5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: '#185fa5' }}>You have onboarding paperwork to complete</div>
              <div style={{ fontSize: '12px', color: '#555', marginTop: '2px' }}>W-4, I-9, direct deposit, and more — takes about 5 minutes.</div>
            </div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: '#185fa5', whiteSpace: 'nowrap' }}>{onboardingLoading ? 'Loading…' : 'Start now →'}</div>
          </div>
        )}

        {/* Onboarding modal */}
        {showOnboarding && onboardingData && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, overflowY: 'auto' }}>
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '2rem 1rem' }}>
              <div style={{ width: '100%', maxWidth: '600px', background: '#fff', borderRadius: '16px', overflow: 'hidden', position: 'relative' }}>
                <button
                  onClick={() => { setShowOnboarding(false); sessionStorage.setItem('onboarding_shown', '1') }}
                  style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', fontSize: '20px', color: '#aaa', cursor: 'pointer', zIndex: 1, lineHeight: 1 }}
                >✕</button>
                <OnboardingFlow
                  token={onboardingData.token}
                  employeeId={onboardingData.employeeId}
                  userId={onboardingData.userId}
                  employeeName={onboardingData.employeeName}
                  welcomePack={onboardingData.welcomePack}
                  docs={onboardingData.docs}
                  isModal
                  onComplete={() => { setShowOnboarding(false); setOnboardingToken(null); sessionStorage.removeItem('onboarding_shown') }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Two-column grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.25rem', alignItems: 'start' }}>

          {/* LEFT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Clock in / out */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>Time clock</div>
              {currentEntry ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                  <div>
                    <div style={{ fontSize: '11px', color: '#27ae60', fontWeight: 600, marginBottom: '4px' }}>&#9679; Clocked in</div>
                    <div style={{ fontSize: '36px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>{elapsed(currentEntry.clock_in)}</div>
                    <div style={{ fontSize: '12px', color: '#aaa', marginTop: '5px' }}>Since {fmtTime(currentEntry.clock_in)}</div>
                  </div>
                  <button
                    onClick={clockOut}
                    disabled={clockLoading}
                    style={{ padding: '11px 28px', borderRadius: '9px', border: 'none', background: '#c0392b', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {clockLoading ? 'Clocking out...' : 'Clock out'}
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                  <div>
                    <div style={{ fontSize: '13px', color: '#888', marginBottom: '2px' }}>
                      {todayShift
                        ? `Today: ${fmt(todayShift.start_time)} – ${fmt(todayShift.end_time)}`
                        : 'No shift scheduled today'}
                    </div>
                    <div style={{ fontSize: '11px', color: '#bbb' }}>Ready to start your shift?</div>
                  </div>
                  <button
                    onClick={clockIn}
                    disabled={clockLoading}
                    style={{ padding: '11px 28px', borderRadius: '9px', border: 'none', background: '#185fa5', color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    {clockLoading ? 'Clocking in...' : 'Clock in'}
                  </button>
                </div>
              )}
              {clockMsg && <div style={{ marginTop: '0.75rem', fontSize: '13px', color: clockMsg.includes('Error') || clockMsg.includes('Already') ? '#c0392b' : '#27ae60' }}>{clockMsg}</div>}
            </div>

            {/* Upcoming shifts */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>Schedule</div>

              {todayShift && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderRadius: '9px', background: '#f0f6ff', border: '1px solid #d0e4fa', marginBottom: '10px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#185fa5', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#185fa5' }}>Today</div>
                    <div style={{ fontSize: '13px', color: '#333', marginTop: '1px' }}>{fmt(todayShift.start_time)} – {fmt(todayShift.end_time)}{todayShift.notes ? ` · ${todayShift.notes}` : ''}</div>
                  </div>
                </div>
              )}

              {upcomingShifts.length === 0 && !todayShift ? (
                <div style={{ fontSize: '13px', color: '#bbb', padding: '4px 0' }}>No upcoming shifts scheduled.</div>
              ) : (
                upcomingShifts.slice(0, 8).map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <div style={{ width: '90px', fontSize: '12px', color: '#888', flexShrink: 0 }}>
                      {fmtDate(s.shift_date)}
                    </div>
                    <div style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: '#222' }}>{fmt(s.start_time)} – {fmt(s.end_time)}</div>
                    {s.notes && <div style={{ fontSize: '11px', color: '#bbb', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.notes}</div>}
                    {swapShiftId === s.id ? (
                      <button onClick={() => setSwapShiftId(null)} style={{ fontSize: '11px', color: '#888', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>Cancel</button>
                    ) : (
                      <button
                        onClick={() => { setSwapShiftId(s.id); setSwapTargetShiftId(''); setSwapNotes('') }}
                        style={{ fontSize: '11px', padding: '3px 9px', borderRadius: '5px', border: '1px solid #dde1ea', background: '#fff', cursor: 'pointer', color: '#555', flexShrink: 0, whiteSpace: 'nowrap' }}>
                        ⇔ Swap
                      </button>
                    )}
                  </div>
                ))
              )}

              {/* Swap request form */}
              {swapShiftId != null && (
                <div style={{ marginTop: '1rem', background: '#f9fafb', borderRadius: '10px', padding: '1rem', border: '1px solid #eee' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '0.75rem' }}>Request shift swap</div>
                  <div style={{ marginBottom: '0.65rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Swap with (optional)</label>
                    <select
                      value={swapTargetShiftId}
                      onChange={e => setSwapTargetShiftId(e.target.value ? Number(e.target.value) : '')}
                      style={{ width: '100%', fontSize: '13px', padding: '7px 9px', border: '1px solid #dde1ea', borderRadius: '7px' }}
                    >
                      <option value="">— Let manager find cover —</option>
                      {coworkerShifts.map(cs => (
                        <option key={cs.id} value={cs.id}>
                          {cs.employee_name} · {fmtDate(cs.shift_date)} {fmt(cs.start_time)}–{fmt(cs.end_time)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginBottom: '0.65rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Reason (optional)</label>
                    <input value={swapNotes} onChange={e => setSwapNotes(e.target.value)} placeholder="e.g. Doctor appointment"
                      style={{ width: '100%', fontSize: '13px', padding: '7px 9px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
                  </div>
                  <button
                    onClick={submitSwapRequest}
                    disabled={swapSaving}
                    style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: '#185fa5', color: '#fff', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}>
                    {swapSaving ? 'Sending...' : 'Send swap request'}
                  </button>
                  {swapMsg && <div style={{ marginTop: '0.5rem', fontSize: '13px', color: swapMsg.includes('Error') ? '#c0392b' : '#27ae60' }}>{swapMsg}</div>}
                </div>
              )}
            </div>

            {/* Open shifts */}
            {openShifts.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #d1fae5' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#166534', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>
                  Open shifts — available to claim
                </div>
                {openShifts.map(s => (
                  <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f0fdf4' }}>
                    <div style={{ width: '90px', fontSize: '12px', color: '#888', flexShrink: 0 }}>{fmtDate(s.shift_date)}</div>
                    <div style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}>{fmt(s.start_time)} – {fmt(s.end_time)}</div>
                    {s.notes && <div style={{ fontSize: '11px', color: '#aaa' }}>{s.notes}</div>}
                    <button
                      onClick={() => claimShift(s.id)}
                      disabled={claimingId === s.id}
                      style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '7px', border: 'none', background: '#166534', color: '#fff', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                      {claimingId === s.id ? '...' : 'Claim'}
                    </button>
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Hours this week */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>This week</div>
              <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1rem' }}>
                <div>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: '#1a1a1a', lineHeight: 1 }}>{weeklyHrs}h{weeklyMinsRem > 0 ? ` ${weeklyMinsRem}m` : ''}</div>
                  <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>Hours worked</div>
                </div>
                {currentEntry && (
                  <div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#27ae60', lineHeight: 1 }}>{elapsed(currentEntry.clock_in)}</div>
                    <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px' }}>This session</div>
                  </div>
                )}
              </div>
              <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3 }}>
                <div style={{ height: '100%', width: `${Math.min((weeklyMins / (40 * 60)) * 100, 100)}%`, background: weeklyMins >= 40 * 60 ? '#c0392b' : '#185fa5', borderRadius: 3, transition: 'width 0.3s' }} />
              </div>
              <div style={{ fontSize: '11px', color: '#bbb', marginTop: '5px' }}>{Math.round((weeklyMins / (40 * 60)) * 100)}% of 40h week</div>
            </div>

            {/* Time off */}
            <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Time off</div>
                <button
                  onClick={() => setShowTOForm(v => !v)}
                  style={{ fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: '1px solid #dde1ea', background: showTOForm ? '#f0f2f5' : '#fff', cursor: 'pointer', fontWeight: 500 }}
                >
                  {showTOForm ? 'Cancel' : '+ Request'}
                </button>
              </div>

              {ptoBalance && (
                <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #f5f5f5' }}>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#1a1a1a' }}>{ptoBalance.remaining}</div>
                    <div style={{ fontSize: '11px', color: '#aaa' }}>Remaining</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#999' }}>{ptoBalance.used}</div>
                    <div style={{ fontSize: '11px', color: '#aaa' }}>Used</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#ccc' }}>{ptoBalance.total}</div>
                    <div style={{ fontSize: '11px', color: '#aaa' }}>Total</div>
                  </div>
                </div>
              )}

              {showTOForm && (
                <div style={{ background: '#f9fafb', borderRadius: '9px', padding: '1rem', marginBottom: '1rem', border: '1px solid #eee' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.65rem', marginBottom: '0.65rem' }}>
                    <div>
                      <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>From</label>
                      <input type="date" value={toStart} onChange={e => setToStart(e.target.value)} style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>To</label>
                      <input type="date" value={toEnd} onChange={e => setToEnd(e.target.value)} min={toStart} style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
                    </div>
                  </div>
                  <div style={{ marginBottom: '0.65rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Type</label>
                    <select value={toType} onChange={e => setToType(e.target.value)} style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }}>
                      <option>PTO</option><option>Sick</option><option>Personal</option><option>Unpaid</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <label style={{ fontSize: '11px', color: '#888', display: 'block', marginBottom: '3px' }}>Reason (optional)</label>
                    <input value={toReason} onChange={e => setToReason(e.target.value)} placeholder="e.g. Doctor appointment" style={{ width: '100%', fontSize: '13px', padding: '7px 8px', border: '1px solid #dde1ea', borderRadius: '7px' }} />
                  </div>
                  <button
                    onClick={submitTimeOff}
                    disabled={toSaving || !toStart || !toEnd}
                    style={{ padding: '8px 18px', borderRadius: '7px', border: 'none', background: '#185fa5', color: '#fff', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
                  >
                    {toSaving ? 'Submitting...' : 'Submit request'}
                  </button>
                  {toMsg && <div style={{ marginTop: '0.5rem', fontSize: '13px', color: toMsg.includes('Error') ? '#c0392b' : '#27ae60' }}>{toMsg}</div>}
                </div>
              )}

              {timeOffRequests.length > 0 && (
                <div>
                  {timeOffRequests.slice(0, 5).map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 500 }}>{r.type}</div>
                        <div style={{ fontSize: '11px', color: '#aaa', marginTop: '1px' }}>{fmtDate(r.start_date)} – {fmtDate(r.end_date)}</div>
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: statusColor[r.status as keyof typeof statusColor] ?? '#888', textTransform: 'capitalize' }}>{r.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Swap requests */}
            {swapRequests.length > 0 && (
              <div style={{ background: '#fff', borderRadius: '14px', padding: '1.5rem', border: '1px solid #eee' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '1rem' }}>My swap requests</div>
                {swapRequests.slice(0, 5).map(sr => {
                  const myShift = shifts.find(s => s.id === sr.requester_shift_id)
                  const swapStatusColor = sr.status === 'approved' ? '#27ae60' : sr.status === 'denied' ? '#c0392b' : '#e67e22'
                  return (
                    <div key={sr.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f5f5f5' }}>
                      <div style={{ fontSize: '12px', color: '#555' }}>
                        {myShift ? fmtDate(myShift.shift_date) : `Shift #${sr.requester_shift_id}`}
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 600, color: swapStatusColor, textTransform: 'capitalize' }}>{sr.status}</span>
                    </div>
                  )
                })}
              </div>
            )}

          </div>
        </div>
      </div>}
    </div>
  )
}
