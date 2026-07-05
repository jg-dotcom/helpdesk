'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Employee = {
  id: number
  name: string
  role: string
}

type TimeOffRequest = {
  id: number
  employee_id: number
  start_date: string
  end_date: string
  type: string
  reason: string | null
  status: string
  created_at: string
}

type Shift = {
  id: number
  employee_id: number
  shift_date: string
  start_time: string
  end_time: string
  notes: string | null
}

type Availability = {
  employee_id: number
  day_of_week: number
  start_time: string
  end_time: string
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function formatDate(iso: string) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function formatTime(t: string) {
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'AM' : 'PM'}`
}

const typeColors: Record<string, string> = {
  'PTO / Vacation': '#185fa5',
  'Sick leave': '#c0392b',
  'Unpaid leave': '#7f8c8d',
}

export default function SchedulePage() {
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [requests, setRequests] = useState<TimeOffRequest[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [tab, setTab] = useState<'requests' | 'calendar' | 'shifts'>('requests')
  const [availability, setAvailability] = useState<Availability[]>([])
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [genWeekStart, setGenWeekStart] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    return d.toISOString().slice(0, 10)
  })

  const now = new Date()
  const [calYear, setCalYear] = useState(now.getFullYear())
  const [calMonth, setCalMonth] = useState(now.getMonth())

  // Shift form
  const [showShiftForm, setShowShiftForm] = useState(false)
  const [shiftEmpId, setShiftEmpId] = useState<number | ''>('')
  const [shiftDate, setShiftDate] = useState('')
  const [shiftStart, setShiftStart] = useState('09:00')
  const [shiftEnd, setShiftEnd] = useState('17:00')
  const [shiftNotes, setShiftNotes] = useState('')
  const [savingShift, setSavingShift] = useState(false)
  const [shiftMsg, setShiftMsg] = useState('')

  // Weekly view state
  const [weekOffset, setWeekOffset] = useState(0)

  useEffect(() => { load() }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    setUserId(session.user.id)

    const [{ data: emps }, { data: reqs }, { data: sh }] = await Promise.all([
      supabase.from('employees').select('id, name, role').eq('user_id', session.user.id).eq('status', 'active'),
      supabase.from('time_off_requests').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }),
      supabase.from('shifts').select('*').eq('user_id', session.user.id).order('shift_date'),
    ])

    if (emps) {
      setEmployees(emps)
      if (emps.length > 0) {
        const empIds = emps.map(e => e.id)
        const { data: avail } = await supabase.from('employee_availability').select('*').in('employee_id', empIds)
        if (avail) setAvailability(avail)
      }
    }
    if (reqs) setRequests(reqs)
    if (sh) setShifts(sh)
    setLoading(false)
  }

  async function handleApprove(id: number, status: 'approved' | 'denied') {
    await supabase.from('time_off_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
  }

  async function handleAddShift() {
    if (!shiftEmpId || !shiftDate) { setShiftMsg('Select an employee and date.'); return }
    setSavingShift(true)
    setShiftMsg('')
    const { error } = await supabase.from('shifts').insert([{
      user_id: userId,
      employee_id: shiftEmpId,
      shift_date: shiftDate,
      start_time: shiftStart,
      end_time: shiftEnd,
      notes: shiftNotes.trim() || null,
    }])
    if (error) {
      setShiftMsg('Error saving shift.')
    } else {
      setShiftMsg('Shift added.')
      setShowShiftForm(false)
      setShiftEmpId('')
      setShiftDate('')
      setShiftNotes('')
      setTimeout(() => setShiftMsg(''), 2000)
      load()
    }
    setSavingShift(false)
  }

  async function handleDeleteShift(id: number) {
    await supabase.from('shifts').delete().eq('id', id)
    setShifts(prev => prev.filter(s => s.id !== id))
  }

  async function generateSchedule() {
    if (availability.length === 0) {
      setGenMsg('No employee availability set yet. Employees need to fill out their availability first.')
      return
    }
    setGenerating(true)
    setGenMsg('')

    // Build week dates (Sun–Sat)
    const weekStart = new Date(genWeekStart + 'T00:00:00')
    const weekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart)
      d.setDate(weekStart.getDate() + i)
      return d.toISOString().slice(0, 10)
    })

    // Find approved time off that overlaps this week
    const approvedOff = requests.filter(r => r.status === 'approved')

    function isOffThisDay(empId: number, dateStr: string) {
      return approvedOff.some(r => r.employee_id === empId && r.start_date <= dateStr && r.end_date >= dateStr)
    }

    // Find existing shifts this week to avoid duplicates
    const existingThisWeek = shifts.filter(s => weekDates.includes(s.shift_date))

    const newShifts: { user_id: string; employee_id: number; shift_date: string; start_time: string; end_time: string; notes: string }[] = []

    weekDates.forEach((dateStr, dayIndex) => {
      const availableToday = availability.filter(a => {
        if (a.day_of_week !== dayIndex) return false
        if (isOffThisDay(a.employee_id, dateStr)) return false
        // Skip if already has a shift this day
        if (existingThisWeek.some(s => s.employee_id === a.employee_id && s.shift_date === dateStr)) return false
        return true
      })

      availableToday.forEach(a => {
        newShifts.push({
          user_id: userId!,
          employee_id: a.employee_id,
          shift_date: dateStr,
          start_time: a.start_time,
          end_time: a.end_time,
          notes: 'Auto-generated',
        })
      })
    })

    if (newShifts.length === 0) {
      setGenMsg('No new shifts to generate — everyone is either off or already scheduled.')
      setGenerating(false)
      return
    }

    const { error } = await supabase.from('shifts').insert(newShifts)
    if (error) {
      setGenMsg('Error generating schedule. Try again.')
    } else {
      setGenMsg(`Generated ${newShifts.length} shift${newShifts.length !== 1 ? 's' : ''}.`)
      load()
    }
    setGenerating(false)
    setTimeout(() => setGenMsg(''), 4000)
  }

  function openShiftFormForDate(dateStr: string) {
    setShiftDate(dateStr)
    setShiftEmpId('')
    setShiftStart('09:00')
    setShiftEnd('17:00')
    setShiftNotes('')
    setShowShiftForm(true)
    setTab('shifts')
  }

  // Weekly view helpers
  function getWeekDays(offset: number) {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + offset * 7)
    d.setHours(0, 0, 0, 0)
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(d)
      day.setDate(d.getDate() + i)
      return day.toISOString().slice(0, 10)
    })
  }

  // Calendar helpers
  const firstDay = new Date(calYear, calMonth, 1).getDay()
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate()

  function getDateStr(day: number) {
    return `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function getTimeOffForDate(dateStr: string) {
    return requests.filter(r =>
      r.status === 'approved' &&
      r.start_date <= dateStr && r.end_date >= dateStr
    )
  }

  function getShiftsForDate(dateStr: string) {
    return shifts.filter(s => s.shift_date === dateStr)
  }

  const empMap = Object.fromEntries(employees.map(e => [e.id, e]))
  const pending = requests.filter(r => r.status === 'pending')

  return (
    <div className="dash-wrap">
      <Nav active="schedule" />

      <div className="dash-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700 }}>Schedule</div>
            <div style={{ fontSize: '13px', color: '#666', marginTop: '2px' }}>Time-off requests and shift scheduling</div>
          </div>
          {tab === 'shifts' && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="date"
                value={genWeekStart}
                onChange={e => setGenWeekStart(e.target.value)}
                style={{ fontSize: '13px', padding: '6px 10px', border: '1px solid #dde1ea', borderRadius: '6px' }}
              />
              <button className="btn" style={{ fontSize: '13px', padding: '7px 14px' }} onClick={generateSchedule} disabled={generating}>
                {generating ? 'Generating...' : 'Auto-schedule'}
              </button>
              <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '13px', padding: '7px 16px' }} onClick={() => setShowShiftForm(v => !v)}>
                {showShiftForm ? 'Cancel' : '+ Add shift'}
              </button>
            </div>
          )}
        </div>

        <div className="profile-tabs" style={{ marginBottom: '1.5rem' }}>
          <button className={`profile-tab${tab === 'requests' ? ' active' : ''}`} onClick={() => setTab('requests')}>
            Time-off requests {pending.length > 0 && <span className="notif-badge" style={{ position: 'relative', top: 0, right: 0, marginLeft: '4px' }}>{pending.length}</span>}
          </button>
          <button className={`profile-tab${tab === 'calendar' ? ' active' : ''}`} onClick={() => setTab('calendar')}>Calendar</button>
          <button className={`profile-tab${tab === 'shifts' ? ' active' : ''}`} onClick={() => setTab('shifts')}>Shifts</button>
        </div>

        {loading ? <div className="card"><div className="empty-state">Loading...</div></div> : (
          <>
            {tab === 'requests' && (
              <div className="card">
                {requests.length === 0 ? (
                  <div className="empty-state">No time-off requests yet.</div>
                ) : (
                  <div className="upload-list">
                    {requests.map(req => {
                      const emp = empMap[req.employee_id]
                      return (
                        <div key={req.id} className="upload-item" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
                          <div className="emp-initials">{emp?.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2) ?? '?'}</div>
                          <div style={{ flex: 1, minWidth: '180px' }}>
                            <div className="upload-name">{emp?.name ?? 'Unknown'}</div>
                            <div className="upload-meta">
                              {req.type} · {formatDate(req.start_date)} – {formatDate(req.end_date)}
                              {req.reason ? ` · "${req.reason}"` : ''}
                            </div>
                          </div>
                          {req.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <button className="btn auth-btn-primary" style={{ width: 'auto', fontSize: '12px', padding: '5px 12px' }} onClick={() => handleApprove(req.id, 'approved')}>Approve</button>
                              <button className="btn" style={{ fontSize: '12px', padding: '5px 12px', color: '#c0392b' }} onClick={() => handleApprove(req.id, 'denied')}>Deny</button>
                            </div>
                          ) : (
                            <span className={`badge ${req.status === 'approved' ? 'badge-green' : 'badge-red'}`}>
                              {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {tab === 'calendar' && (
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <button className="btn" style={{ padding: '4px 10px', fontSize: '14px' }} onClick={() => {
                    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1) } else setCalMonth(m => m - 1)
                  }}>←</button>
                  <div style={{ fontWeight: 600 }}>{MONTHS[calMonth]} {calYear}</div>
                  <button className="btn" style={{ padding: '4px 10px', fontSize: '14px' }} onClick={() => {
                    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1) } else setCalMonth(m => m + 1)
                  }}>→</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
                  {DAYS.map(d => <div key={d} style={{ fontSize: '11px', fontWeight: 600, color: '#999', textAlign: 'center', padding: '4px 0' }}>{d}</div>)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
                  {Array.from({ length: firstDay }).map((_, i) => <div key={`blank-${i}`} />)}
                  {Array.from({ length: daysInMonth }).map((_, i) => {
                    const day = i + 1
                    const dateStr = getDateStr(day)
                    const timeoffs = getTimeOffForDate(dateStr)
                    const dayShifts = getShiftsForDate(dateStr)
                    const isToday = dateStr === now.toISOString().slice(0, 10)
                    return (
                      <div key={day} onClick={() => openShiftFormForDate(dateStr)} style={{ minHeight: '70px', border: '1px solid #eee', borderRadius: '6px', padding: '4px', background: isToday ? '#f0f6ff' : '#fff', cursor: 'pointer', transition: 'border-color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.borderColor = '#185fa5')} onMouseLeave={e => (e.currentTarget.style.borderColor = '#eee')}>
                        <div style={{ fontSize: '12px', fontWeight: isToday ? 700 : 400, color: isToday ? '#185fa5' : '#333', marginBottom: '2px' }}>{day}</div>
                        {timeoffs.map(t => (
                          <div key={t.id} style={{ fontSize: '10px', background: typeColors[t.type] || '#185fa5', color: '#fff', borderRadius: '3px', padding: '1px 4px', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {empMap[t.employee_id]?.name.split(' ')[0] ?? '?'} off
                          </div>
                        ))}
                        {dayShifts.map(s => (
                          <div key={s.id} style={{ fontSize: '10px', background: '#e8f4e8', color: '#2d6a2d', borderRadius: '3px', padding: '1px 4px', marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {empMap[s.employee_id]?.name.split(' ')[0] ?? '?'} {formatTime(s.start_time)}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', fontSize: '12px', color: '#666' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#185fa5' }} /> Time off</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '10px', height: '10px', borderRadius: '2px', background: '#e8f4e8', border: '1px solid #2d6a2d' }} /> Shift</div>
                </div>
              </div>
            )}

            {tab === 'shifts' && (() => {
              const weekDays = getWeekDays(weekOffset)
              const weekStart = new Date(weekDays[0] + 'T00:00:00')
              const weekEnd = new Date(weekDays[6] + 'T00:00:00')
              const weekLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              const today = new Date().toISOString().slice(0, 10)
              return (
                <div>
                  {showShiftForm && (
                    <div className="card" style={{ marginBottom: '1rem' }}>
                      <div style={{ fontWeight: 600, marginBottom: '0.75rem', fontSize: '14px' }}>
                        {shiftDate ? `New shift — ${new Date(shiftDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}` : 'New shift'}
                      </div>
                      <div className="row2" style={{ marginBottom: '0.75rem' }}>
                        <div className="field">
                          <label>Employee</label>
                          <select value={shiftEmpId} onChange={e => setShiftEmpId(Number(e.target.value))}>
                            <option value="">Select...</option>
                            {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                          </select>
                        </div>
                        <div className="field">
                          <label>Date</label>
                          <input type="date" value={shiftDate} onChange={e => setShiftDate(e.target.value)} />
                        </div>
                      </div>
                      <div className="row2" style={{ marginBottom: '0.75rem' }}>
                        <div className="field">
                          <label>Start time</label>
                          <input type="time" value={shiftStart} onChange={e => setShiftStart(e.target.value)} />
                        </div>
                        <div className="field">
                          <label>End time</label>
                          <input type="time" value={shiftEnd} onChange={e => setShiftEnd(e.target.value)} />
                        </div>
                      </div>
                      <div className="field" style={{ marginBottom: '0.75rem' }}>
                        <label>Notes (optional)</label>
                        <input value={shiftNotes} onChange={e => setShiftNotes(e.target.value)} placeholder="e.g. Opening shift" />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <button className="btn auth-btn-primary" style={{ width: 'auto' }} onClick={handleAddShift} disabled={savingShift}>
                          {savingShift ? 'Saving...' : 'Save shift'}
                        </button>
                        <button className="btn" style={{ width: 'auto' }} onClick={() => setShowShiftForm(false)}>Cancel</button>
                        {shiftMsg && <div className="done-msg">{shiftMsg}</div>}
                      </div>
                    </div>
                  )}

                  {genMsg && <div className={genMsg.startsWith('Error') || genMsg.startsWith('No employee') || genMsg.startsWith('No new') ? 'auth-error' : 'done-msg'} style={{ marginBottom: '1rem' }}>{genMsg}</div>}

                  {/* Week navigator */}
                  <div className="card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <button className="btn" style={{ padding: '4px 10px', fontSize: '14px' }} onClick={() => setWeekOffset(o => o - 1)}>←</button>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{weekLabel}</div>
                      <button className="btn" style={{ padding: '4px 10px', fontSize: '14px' }} onClick={() => setWeekOffset(o => o + 1)}>→</button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px' }}>
                      {weekDays.map((dateStr, i) => {
                        const dayShifts = shifts.filter(s => s.shift_date === dateStr)
                        const isToday = dateStr === today
                        const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]
                        const dayNum = new Date(dateStr + 'T00:00:00').getDate()
                        return (
                          <div
                            key={dateStr}
                            onClick={() => openShiftFormForDate(dateStr)}
                            style={{ minHeight: '100px', border: `1px solid ${isToday ? '#185fa5' : '#eee'}`, borderRadius: '8px', padding: '8px', background: isToday ? '#f0f6ff' : '#fafafa', cursor: 'pointer', transition: 'border-color 0.15s' }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = '#185fa5')}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = isToday ? '#185fa5' : '#eee')}
                          >
                            <div style={{ fontSize: '11px', fontWeight: 600, color: isToday ? '#185fa5' : '#888', marginBottom: '6px' }}>{dayName} {dayNum}</div>
                            {dayShifts.length === 0 ? (
                              <div style={{ fontSize: '10px', color: '#ccc', marginTop: '4px' }}>+ Add</div>
                            ) : dayShifts.map(s => (
                              <div key={s.id} style={{ marginBottom: '4px' }}>
                                <div style={{ fontSize: '10px', background: '#e8edf8', color: '#185fa5', borderRadius: '4px', padding: '3px 5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '3px' }}>
                                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>{empMap[s.employee_id]?.name.split(' ')[0] ?? '?'}</span>
                                  <button onClick={e => { e.stopPropagation(); handleDeleteShift(s.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c0392b', fontSize: '11px', lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
                                </div>
                                <div style={{ fontSize: '10px', color: '#888', marginTop: '1px' }}>{formatTime(s.start_time)}–{formatTime(s.end_time)}</div>
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })()}
          </>
        )}
      </div>
    </div>
  )
}
