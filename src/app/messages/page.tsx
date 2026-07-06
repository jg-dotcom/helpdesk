'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Channel = {
  id: string
  name: string
  type: 'group' | 'dm'
  employeeId: number | null
  lastMessage: { sender_name: string; content: string; created_at: string } | null
  unreadCount: number
}

type Message = {
  id: number
  sender_id: string
  sender_name: string
  content: string
  created_at: string
}

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

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function groupByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = []
  for (const msg of messages) {
    const date = new Date(msg.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const last = groups[groups.length - 1]
    if (last?.date === date) {
      last.messages.push(msg)
    } else {
      groups.push({ date, messages: [msg] })
    }
  }
  return groups
}

export default function MessagesPage() {
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [businessId, setBusinessId] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior }), 50)
  }, [])

  async function loadChannels(tk: string) {
    setLoadingChannels(true)
    const res = await fetch('/api/messages/channels', {
      headers: { Authorization: `Bearer ${tk}` },
    })
    const data = await res.json()
    if (res.ok) {
      setBusinessId(data.businessId)
      setChannels(data.channels)
      if (data.channels.length > 0) {
        openChannel(data.channels[0], tk, data.businessId)
      }
    }
    setLoadingChannels(false)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setToken(session.access_token)
      setUserId(session.user.id)
      loadChannels(session.access_token)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openChannel(ch: Channel, tk = token, bid = businessId) {
    setActiveChannel(ch)
    setLoadingThread(true)
    setMessages([])
    const res = await fetch(`/api/messages/thread?channel=${ch.id}&businessId=${bid}`, {
      headers: { Authorization: `Bearer ${tk}` },
    })
    const data = await res.json()
    if (res.ok) setMessages(data.messages)
    setLoadingThread(false)
    scrollToBottom('auto')
    // Mark as read
    if (ch.unreadCount > 0) {
      fetch('/api/messages/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ channel: ch.id, businessId: bid }),
      })
      setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, unreadCount: 0 } : c))
    }
  }

  // Realtime: subscribe to new messages for this business
  useEffect(() => {
    if (!businessId) return
    const sub = supabase
      .channel(`chat:${businessId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `business_id=eq.${businessId}`,
      }, (payload) => {
        const msg = payload.new as Message & { channel: string }
        // Update thread if viewing this channel
        setActiveChannel(ch => {
          if (ch?.id === msg.channel) {
            setMessages(prev => [...prev, msg])
            scrollToBottom()
          }
          return ch
        })
        // Update channel list last message
        setChannels(prev => prev.map(c => {
          if (c.id === msg.channel) {
            return {
              ...c,
              lastMessage: { sender_name: msg.sender_name, content: msg.content, created_at: msg.created_at },
              unreadCount: msg.sender_id !== userId ? c.unreadCount + 1 : c.unreadCount,
            }
          }
          return c
        }))
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [businessId, userId, scrollToBottom])

  async function send() {
    const content = input.trim()
    if (!content || sending || !activeChannel) return
    setInput('')
    setSending(true)

    const res = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ channel: activeChannel.id, businessId, content }),
    })
    const data = await res.json()
    if (res.ok) {
      setMessages(prev => [...prev, data.message])
      scrollToBottom()
      setChannels(prev => prev.map(c =>
        c.id === activeChannel.id
          ? { ...c, lastMessage: { sender_name: data.message.sender_name, content: data.message.content, created_at: data.message.created_at } }
          : c
      ))
    }
    setSending(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  useEffect(() => {
    if (messages.length > 0) scrollToBottom('auto')
  }, [activeChannel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = groupByDate(messages)
  const totalUnread = channels.reduce((s, c) => s + c.unreadCount, 0)

  return (
    <div className="dash-wrap">
      <Nav active="messages" />

      <div style={{ display: 'flex', height: 'calc(100vh - 64px)', background: '#f5f6fa' }}>

        {/* Sidebar */}
        <div style={{
          width: '280px',
          flexShrink: 0,
          background: '#fff',
          borderRight: '0.5px solid #e8eaed',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ padding: '1.25rem 1.25rem 0.75rem', borderBottom: '0.5px solid #f0f0f0' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1a1a1a' }}>Messages</div>
            {totalUnread > 0 && (
              <div style={{ fontSize: '12px', color: '#888', marginTop: '2px' }}>{totalUnread} unread</div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingChannels ? (
              <div style={{ padding: '2rem', textAlign: 'center', fontSize: '13px', color: '#bbb' }}>Loading…</div>
            ) : channels.map(ch => (
              <div
                key={ch.id}
                onClick={() => openChannel(ch)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 14px',
                  cursor: 'pointer',
                  background: activeChannel?.id === ch.id ? '#f0f6ff' : 'transparent',
                  borderLeft: `3px solid ${activeChannel?.id === ch.id ? '#185fa5' : 'transparent'}`,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (activeChannel?.id !== ch.id) (e.currentTarget as HTMLDivElement).style.background = '#fafafa' }}
                onMouseLeave={e => { if (activeChannel?.id !== ch.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
              >
                {/* Avatar */}
                <div style={{
                  width: 38,
                  height: 38,
                  borderRadius: ch.type === 'group' ? '10px' : '50%',
                  background: ch.type === 'group' ? '#185fa5' : '#e8f0fe',
                  color: ch.type === 'group' ? '#fff' : '#185fa5',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: ch.type === 'group' ? '16px' : '13px',
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {ch.type === 'group' ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  ) : ch.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <div style={{ fontSize: '13px', fontWeight: ch.unreadCount > 0 ? 700 : 500, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.name}
                    </div>
                    {ch.lastMessage && (
                      <div style={{ fontSize: '11px', color: '#bbb', flexShrink: 0, marginLeft: '6px' }}>
                        {timeAgo(ch.lastMessage.created_at)}
                      </div>
                    )}
                  </div>
                  {ch.lastMessage ? (
                    <div style={{ fontSize: '12px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ch.lastMessage.sender_name}: {ch.lastMessage.content}
                    </div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#bbb', fontStyle: 'italic' }}>No messages yet</div>
                  )}
                </div>

                {/* Unread badge */}
                {ch.unreadCount > 0 && (
                  <div style={{
                    minWidth: 18, height: 18, borderRadius: '99px',
                    background: '#185fa5', color: '#fff',
                    fontSize: '11px', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 5px', flexShrink: 0,
                  }}>
                    {ch.unreadCount}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Thread header */}
          {activeChannel && (
            <div style={{
              background: '#fff',
              borderBottom: '0.5px solid #e8eaed',
              padding: '0 1.5rem',
              height: '56px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0,
            }}>
              <div style={{
                width: 32, height: 32,
                borderRadius: activeChannel.type === 'group' ? '8px' : '50%',
                background: activeChannel.type === 'group' ? '#185fa5' : '#e8f0fe',
                color: activeChannel.type === 'group' ? '#fff' : '#185fa5',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: activeChannel.type === 'group' ? '14px' : '11px', fontWeight: 700,
              }}>
                {activeChannel.type === 'group' ? (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                ) : activeChannel.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>{activeChannel.name}</div>
                <div style={{ fontSize: '11px', color: '#999' }}>
                  {activeChannel.type === 'group' ? 'Team group chat' : 'Direct message'}
                </div>
              </div>
            </div>
          )}

          {/* Messages area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
            {!activeChannel ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb', fontSize: '14px' }}>
                Select a conversation
              </div>
            ) : loadingThread ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb', fontSize: '14px' }}>
                Loading…
              </div>
            ) : messages.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb', fontSize: '14px' }}>
                No messages yet. Say hello!
              </div>
            ) : (
              grouped.map(group => (
                <div key={group.date}>
                  {/* Date divider */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '1.25rem 0 1rem' }}>
                    <div style={{ flex: 1, height: '0.5px', background: '#e8eaed' }} />
                    <div style={{ fontSize: '11px', color: '#bbb', fontWeight: 500, whiteSpace: 'nowrap' }}>{group.date}</div>
                    <div style={{ flex: 1, height: '0.5px', background: '#e8eaed' }} />
                  </div>

                  {group.messages.map((msg, i) => {
                    const isMe = msg.sender_id === userId
                    const prevMsg = i > 0 ? group.messages[i - 1] : null
                    const showName = !isMe && (prevMsg?.sender_id !== msg.sender_id)

                    return (
                      <div
                        key={msg.id}
                        style={{
                          display: 'flex',
                          justifyContent: isMe ? 'flex-end' : 'flex-start',
                          marginBottom: '6px',
                          marginTop: showName ? '12px' : '0',
                        }}
                      >
                        {!isMe && (
                          <div style={{
                            width: 30, height: 30,
                            borderRadius: '50%',
                            background: '#e8f0fe',
                            color: '#185fa5',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '11px', fontWeight: 700,
                            flexShrink: 0, marginRight: '8px', alignSelf: 'flex-end',
                            opacity: showName ? 1 : 0,
                          }}>
                            {msg.sender_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div style={{ maxWidth: '68%' }}>
                          {showName && (
                            <div style={{ fontSize: '11px', color: '#888', fontWeight: 600, marginBottom: '4px', marginLeft: '2px' }}>
                              {msg.sender_name}
                            </div>
                          )}
                          <div style={{
                            padding: '9px 13px',
                            borderRadius: isMe ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                            background: isMe ? '#185fa5' : '#fff',
                            color: isMe ? '#fff' : '#1a1a1a',
                            fontSize: '14px',
                            lineHeight: 1.5,
                            border: isMe ? 'none' : '0.5px solid #e8eaed',
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}>
                            {msg.content}
                          </div>
                          <div style={{ fontSize: '11px', color: '#bbb', marginTop: '3px', textAlign: isMe ? 'right' : 'left', paddingLeft: isMe ? 0 : '2px', paddingRight: isMe ? '2px' : 0 }}>
                            {fmtTime(msg.created_at)}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          {activeChannel && (
            <div style={{ background: '#fff', borderTop: '0.5px solid #e8eaed', padding: '1rem 1.5rem', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', background: '#f5f6fa', borderRadius: '12px', padding: '8px 12px', border: '0.5px solid #e8eaed' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder={`Message ${activeChannel.name}…`}
                  rows={1}
                  disabled={sending}
                  style={{
                    flex: 1, resize: 'none', fontSize: '14px', padding: '4px 2px',
                    border: 'none', background: 'transparent',
                    fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
                    maxHeight: '120px', overflowY: 'auto', color: '#1a1a1a',
                  }}
                  onInput={e => {
                    const t = e.currentTarget
                    t.style.height = 'auto'
                    t.style.height = `${Math.min(t.scrollHeight, 120)}px`
                  }}
                />
                <button
                  onClick={send}
                  disabled={sending || !input.trim()}
                  style={{
                    width: 34, height: 34, borderRadius: '8px', border: 'none', flexShrink: 0,
                    background: input.trim() && !sending ? '#185fa5' : '#dde1ea',
                    color: '#fff', cursor: input.trim() && !sending ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#bbb', marginTop: '5px', textAlign: 'center' }}>
                Enter to send · Shift+Enter for new line
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
