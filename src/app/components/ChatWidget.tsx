'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

type ChatAction = { tool: string; title: string; detail: string }
type Message = { role: 'user' | 'assistant'; content: string; actions?: ChatAction[] }

function ActionCard({ action }: { action: ChatAction }) {
  return (
    <div style={{
      background: '#eaf3de', border: '0.5px solid rgba(99,153,34,0.3)', borderRadius: '10px',
      padding: '7px 10px', marginBottom: '6px', marginLeft: '33px', maxWidth: '80%',
    }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: '#3b6d11', display: 'flex', alignItems: 'center', gap: '5px' }}>
        <span>✓</span> {action.title}
      </div>
      <div style={{ fontSize: '11px', color: '#5a7a3a', marginTop: '1px' }}>{action.detail}</div>
    </div>
  )
}

const OWNER_SUGGESTIONS = [
  'List all my employees',
  'Show pending time off requests',
  'Who applied for jobs recently?',
  'Generate a job description for a barista',
]

const EMPLOYEE_SUGGESTIONS = [
  'How many PTO days do I have left?',
  'Clock me in',
  'Request time off next Friday',
  'Show my upcoming schedule',
]

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '10px',
    }}>
      {!isUser && (
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: '#185fa5', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '11px', fontWeight: 700, flexShrink: 0,
          marginRight: '7px', alignSelf: 'flex-end',
        }}>AI</div>
      )}
      <div style={{
        maxWidth: '80%',
        padding: '8px 12px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: isUser ? '#185fa5' : '#fff',
        color: isUser ? '#fff' : '#1a1a1a',
        fontSize: '13px',
        lineHeight: 1.55,
        border: isUser ? 'none' : '0.5px solid rgba(0,0,0,0.12)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  )
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState('')
  const [isOwner, setIsOwner] = useState<boolean | null>(null)
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // JAY-42 — whether the restore-from-history fetch has completed, so the
  // greeting effect below knows to wait for it instead of racing ahead with
  // a blank greeting that then gets overwritten.
  const [historyChecked, setHistoryChecked] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      setToken(session.access_token)
      const { data: biz } = await supabase.from('business_profiles').select('id').eq('user_id', session.user.id).maybeSingle()
      setIsOwner(!!biz)

      // JAY-42 — restore the last 20 messages instead of always starting blank.
      try {
        const res = await fetch('/api/ai/chat', { headers: { Authorization: `Bearer ${session.access_token}` } })
        if (res.ok) {
          const data = await res.json()
          if (data.messages?.length) {
            setMessages(data.messages.map((m: { role: string; content: string; actions?: ChatAction[] }) => ({
              role: m.role, content: m.content, actions: m.actions ?? undefined,
            })))
          }
        }
      } catch { /* restore is best-effort — falls through to the greeting below */ }
      setHistoryChecked(true)
    })
  }, [])

  // Set initial greeting when role is determined AND there's no restored history.
  useEffect(() => {
    if (isOwner === null || !historyChecked || messages.length > 0) return
    setMessages([{
      role: 'assistant',
      content: isOwner
        ? "Hi! I can manage employees, handle applicants, generate job descriptions, approve time off, and pull up analytics — just ask."
        : "Hi! I can clock you in/out, check your PTO, request time off, or show your schedule — just ask.",
    }])
  }, [isOwner, historyChecked]) // eslint-disable-line react-hooks/exhaustive-deps

  // JAY-42 — "+ New" clears stored history server-side and resets the local
  // view back to the greeting, matching the mockup's header button.
  async function startNewThread() {
    if (!token) return
    setMessages([])
    try {
      await fetch('/api/ai/chat', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    } catch { /* best-effort — local view is already reset */ }
    setMessages([{
      role: 'assistant',
      content: isOwner
        ? "Hi! I can manage employees, handle applicants, generate job descriptions, approve time off, and pull up analytics — just ask."
        : "Hi! I can clock you in/out, check your PTO, request time off, or show your schedule — just ask.",
    }])
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }, [open])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        // Don't close when clicking the toggle button — handled by toggle itself
        const toggleBtn = document.getElementById('chat-widget-toggle')
        if (toggleBtn && toggleBtn.contains(e.target as Node)) return
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading || !token) return
    setInput('')

    const userMsg: Message = { role: 'user', content }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setLoading(true)

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          timezone,
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? 'Something went wrong.', actions: data.actions }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong.' }])
    }
    setLoading(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const suggestions = isOwner ? OWNER_SUGGESTIONS : EMPLOYEE_SUGGESTIONS
  const usedSuggestions = new Set(messages.filter(m => m.role === 'user').map(m => m.content))
  const remainingSuggestions = suggestions.filter(s => !usedSuggestions.has(s))

  return (
    <>
      {/* Floating panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            bottom: '84px',
            right: '24px',
            width: '360px',
            height: '500px',
            background: '#f7f7f5',
            borderRadius: '16px',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 9999,
            border: '0.5px solid rgba(0,0,0,0.10)',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: '#185fa5', color: '#fff', flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700,
              }}>AI</div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700 }}>HR Assistant</div>
                <div style={{ fontSize: '11px', opacity: 0.8 }}>Powered by Claude</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {messages.length > 1 && (
                <button
                  onClick={startNewThread}
                  title="Start a new conversation"
                  style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '11px', fontWeight: 600, borderRadius: '6px', padding: '4px 8px', lineHeight: 1 }}
                >+ New</button>
              )}
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '20px', opacity: 0.8, lineHeight: 1, padding: '2px 4px' }}
              >×</button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px' }}>
            {messages.map((msg, i) => (
              <div key={i}>
                {msg.actions?.map((a, j) => <ActionCard key={j} action={a} />)}
                <Bubble msg={msg} />
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#185fa5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0 }}>AI</div>
                <div style={{ padding: '8px 12px', background: '#fff', borderRadius: '14px 14px 14px 4px', border: '0.5px solid rgba(0,0,0,0.12)', display: 'flex', gap: '4px', alignItems: 'center' }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: '#9a9a9a', animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}

            {/* Suggestion chips — JAY-38: reappear after every assistant turn (not just
                the first), filtered down to suggestions the person hasn't already used
                this session so they stay "still actionable" instead of repeating. */}
            {!loading && isOwner !== null && messages.length > 0 && messages[messages.length - 1].role === 'assistant' && remainingSuggestions.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                {remainingSuggestions.map(s => (
                  <button key={s} onClick={() => send(s)}
                    style={{
                      padding: '5px 11px', borderRadius: '999px', fontSize: '12px',
                      border: '0.5px solid rgba(0,0,0,0.18)', background: '#fff',
                      color: '#1a1a1a', cursor: 'pointer', fontFamily: 'inherit',
                    }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.10)', background: '#fff', padding: '10px 12px', flexShrink: 0 }}>
            {isOwner !== null && (
              <div style={{ fontSize: '11px', color: '#9a9a9a', marginBottom: '7px' }}>
                {isOwner
                  ? 'Stuck? You can always make this change directly from the dashboard.'
                  : 'Need a person? Contact your manager directly.'}
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                placeholder="Ask anything or give a command…"
                rows={1}
                disabled={loading}
                style={{
                  flex: 1, resize: 'none', fontSize: '13px', padding: '8px 11px',
                  borderRadius: '10px', border: '0.5px solid rgba(0,0,0,0.20)',
                  fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                  maxHeight: '80px', overflowY: 'auto',
                }}
                onInput={e => {
                  const t = e.currentTarget
                  t.style.height = 'auto'
                  t.style.height = `${Math.min(t.scrollHeight, 80)}px`
                }}
              />
              <button
                onClick={() => send()}
                disabled={loading || !input.trim()}
                style={{
                  padding: '8px 14px', borderRadius: '10px', fontSize: '13px', fontWeight: 600,
                  background: loading || !input.trim() ? '#c5c5c5' : '#185fa5',
                  color: '#fff', border: 'none', cursor: loading || !input.trim() ? 'default' : 'pointer',
                  fontFamily: 'inherit', flexShrink: 0, transition: 'background 0.15s',
                }}
              >Send</button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle button */}
      <button
        id="chat-widget-toggle"
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: '#185fa5',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          boxShadow: '0 4px 16px rgba(24,95,165,0.40)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: open ? '22px' : '20px',
          transition: 'transform 0.15s, background 0.15s',
          transform: open ? 'scale(0.94)' : 'scale(1)',
        }}
        title="HR Assistant"
      >
        {open ? '×' : '✦'}
      </button>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
      `}</style>
    </>
  )
}
