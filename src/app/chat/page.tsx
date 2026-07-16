'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Message = { role: 'user' | 'assistant'; content: string }

const OWNER_SUGGESTIONS = [
  'List all my employees',
  'Show me a summary of payroll this month',
  'Who applied for jobs recently?',
  'Generate a job description for a barista',
  'Show pending time off requests',
]

const EMPLOYEE_SUGGESTIONS = [
  'How many PTO days do I have left?',
  'Clock me in',
  'Request time off next Friday',
  'Show my upcoming schedule',
  'What time off requests do I have?',
]

function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: '12px',
    }}>
      {!isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: '#1d4ed8', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '13px', fontWeight: 700, flexShrink: 0,
          marginRight: '8px', alignSelf: 'flex-end',
        }}>AI</div>
      )}
      <div style={{
        maxWidth: '75%',
        padding: '10px 14px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? '#1d4ed8' : '#1e293b',
        color: isUser ? '#fff' : '#e2e8f0',
        fontSize: '14px',
        lineHeight: 1.6,
        border: isUser ? 'none' : '1px solid rgba(255,255,255,0.07)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}>
        {msg.content}
      </div>
    </div>
  )
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [token, setToken] = useState('')
  const [isOwner, setIsOwner] = useState<boolean | null>(null)
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setToken(session.access_token)
      // Determine role to show appropriate suggestions
      const { data: biz } = await supabase.from('business_profiles').select('id').eq('user_id', session.user.id).maybeSingle()
      setIsOwner(!!biz)
      setMessages([{
        role: 'assistant',
        content: biz
          ? "Hi! I'm your HR assistant. I can manage employees, handle applicants, generate job descriptions, approve time off, and pull up analytics — just tell me what you need."
          : "Hi! I'm your HR assistant. I can clock you in or out, check your PTO, request time off, or show your schedule — just ask.",
      }])
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || loading) return
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
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? 'Something went wrong.' }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    }
    setLoading(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const suggestions = isOwner ? OWNER_SUGGESTIONS : EMPLOYEE_SUGGESTIONS

  return (
    <div className="dash-wrap">
      <Nav active="dashboard" />
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem', maxWidth: '760px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

          {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#1d4ed8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700 }}>AI</div>
              <div style={{ padding: '10px 14px', background: '#1e293b', borderRadius: '16px 16px 16px 4px', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: '4px', alignItems: 'center' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#64748b', animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                ))}
              </div>
            </div>
          )}

          {/* Suggestion chips — show only after first AI message, before any user message */}
          {messages.length === 1 && !loading && isOwner !== null && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
              {suggestions.map(s => (
                <button key={s} onClick={() => send(s)}
                  style={{
                    padding: '6px 14px', borderRadius: '999px', fontSize: '13px',
                    border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
                    color: '#e2e8f0', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', background: '#1e293b', padding: '1rem', boxSizing: 'border-box' }}>
          <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Ask anything or give a command…"
              rows={1}
              disabled={loading}
              style={{
                flex: 1, resize: 'none', fontSize: '14px', padding: '10px 14px',
                borderRadius: '12px', border: '1px solid rgba(255,255,255,0.15)',
                background: 'rgba(255,255,255,0.05)', color: '#e2e8f0',
                fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                maxHeight: '120px', overflowY: 'auto',
              }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = `${Math.min(t.scrollHeight, 120)}px`
              }}
            />
            <button
              onClick={() => send()}
              disabled={loading || !input.trim()}
              className="btn"
              style={{ padding: '10px 18px', flexShrink: 0, fontSize: '14px', borderRadius: '12px', background: '#3b82f6', color: '#fff', border: 'none' }}
            >
              Send
            </button>
          </div>
          <div style={{ maxWidth: '760px', margin: '6px auto 0', fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
            Press Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  )
}
