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
          background: '#185fa5', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '13px', fontWeight: 700, flexShrink: 0,
          marginRight: '8px', alignSelf: 'flex-end',
        }}>AI</div>
      )}
      <div style={{
        maxWidth: '75%',
        padding: '10px 14px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        background: isUser ? '#185fa5' : '#fff',
        color: isUser ? '#fff' : '#1a1a1a',
        fontSize: '14px',
        lineHeight: 1.6,
        border: isUser ? 'none' : '0.5px solid rgba(0,0,0,0.12)',
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
      <Nav active="chat" />
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem', maxWidth: '760px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

          {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}

          {/* Typing indicator */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#185fa5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700 }}>AI</div>
              <div style={{ padding: '10px 14px', background: '#fff', borderRadius: '16px 16px 16px 4px', border: '0.5px solid rgba(0,0,0,0.12)', display: 'flex', gap: '4px', alignItems: 'center' }}>
                {[0, 1, 2].map(i => (
                  <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#9a9a9a', animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
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
                    border: '0.5px solid rgba(0,0,0,0.20)', background: '#fff',
                    color: '#1a1a1a', cursor: 'pointer', fontFamily: 'inherit',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f7f7f5')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{ borderTop: '0.5px solid rgba(0,0,0,0.10)', background: '#fff', padding: '1rem', boxSizing: 'border-box' }}>
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
                borderRadius: '12px', border: '0.5px solid rgba(0,0,0,0.22)',
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
              className="btn auth-btn-primary"
              style={{ padding: '10px 18px', flexShrink: 0, fontSize: '14px', borderRadius: '12px' }}
            >
              Send
            </button>
          </div>
          <div style={{ maxWidth: '760px', margin: '6px auto 0', fontSize: '11px', color: '#9a9a9a', textAlign: 'center' }}>
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
