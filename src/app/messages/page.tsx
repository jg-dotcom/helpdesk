'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Nav from '../components/Nav'

type Attachment = { id?: number; file_name: string; file_type: string; file_size: number; url: string; storage_path?: string }
type ReactionGroup = { reaction: string; count: number; users: string[]; reacted: boolean }

type Message = {
  id: number
  sender_id: string
  sender_name: string
  content: string
  created_at: string
  parent_id?: number | null
  edited_at?: string | null
  is_deleted?: boolean
  is_pinned?: boolean
  reply_count?: number
  reactions?: ReactionGroup[]
  attachments?: Attachment[]
}

type Channel = {
  id: string
  name: string
  type: 'group' | 'dm'
  employeeId: number | null
  lastMessage: { sender_name: string; content: string; created_at: string } | null
  unreadCount: number
  mentioned: boolean
}

// ── SVG reaction icons ──────────────────────────────────────────────────────
const REACTIONS = [
  { key: 'thumbs_up', label: 'Thumbs up', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg> },
  { key: 'check', label: 'Check', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> },
  { key: 'heart', label: 'Heart', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> },
  { key: 'plus_one', label: '+1', icon: <span style={{ fontSize: '11px', fontWeight: 700, lineHeight: 1 }}>+1</span> },
]

// "More" emoji picker — message_reactions.reaction is already free text with no enum
// constraint (see messaging_features.sql), so any of these can be stored as-is, no
// schema change. The 4 quick-react icons above stay unchanged as the fast path.
const MORE_EMOJIS = ['😀', '😂', '😍', '😮', '😢', '😡', '🎉', '🔥', '👏', '🙏', '💯', '🤔']

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function isImage(type: string) { return type.startsWith('image/') }

function groupByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = []
  for (const msg of messages) {
    const date = new Date(msg.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    const last = groups[groups.length - 1]
    if (last?.date === date) last.messages.push(msg)
    else groups.push({ date, messages: [msg] })
  }
  return groups
}

// Render @mention highlighted content
function renderContent(content: string) {
  const parts = content.split(/(@\w[\w\s]*)/g)
  return parts.map((part, i) =>
    part.startsWith('@') ? <span key={i} style={{ color: 'var(--accent)', fontWeight: 600 }}>{part}</span> : part
  )
}

export default function MessagesPage() {
  const [token, setToken] = useState('')
  const [userId, setUserId] = useState('')
  const [isOwner, setIsOwner] = useState(false)
  const [businessId, setBusinessId] = useState('')
  const [channels, setChannels] = useState<Channel[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<{ parentId?: number; message: string } | null>(null)
  const [loadingChannels, setLoadingChannels] = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)

  // Search
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: number; channel: string; sender_name: string; content: string; created_at: string }[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hover actions
  const [hoveredMsgId, setHoveredMsgId] = useState<number | null>(null)
  const [reactionPickerMsgId, setReactionPickerMsgId] = useState<number | null>(null)
  const [moreEmojiOpen, setMoreEmojiOpen] = useState(false)

  // Edit
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null)
  const [editContent, setEditContent] = useState('')

  // Thread panel
  const [threadParent, setThreadParent] = useState<Message | null>(null)
  const [threadMessages, setThreadMessages] = useState<Message[]>([])
  const [threadInput, setThreadInput] = useState('')
  const [loadingThreadPanel, setLoadingThreadPanel] = useState(false)
  const threadBottomRef = useRef<HTMLDivElement>(null)

  // File upload
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // @mention autocomplete
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [employees, setEmployees] = useState<{ id: number; name: string }[]>([])

  // JAY-19 — owner-only "Create group" modal (name + hand-picked members).
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<number[]>([])
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback((behavior: 'smooth' | 'auto' = 'smooth') => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior }), 50)
  }, [])

  // ── Load employees for @mention ──────────────────────────────────────────
  async function loadEmployees(bid: string, tk: string) {
    const res = await fetch('/api/messages/channels', { headers: { Authorization: `Bearer ${tk}` } })
    // employees are loaded separately
    const { data } = await supabase.from('employees').select('id, name').eq('user_id', bid).neq('status', 'terminated')
    if (data) setEmployees(data)
  }

  // ── Auth + initial load ──────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { window.location.href = '/login'; return }
      setToken(session.access_token)
      setUserId(session.user.id)
      // Check if owner
      const { data: biz } = await supabase.from('business_profiles').select('user_id').eq('user_id', session.user.id).maybeSingle()
      setIsOwner(!!biz)
      loadChannels(session.access_token)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Search ───────────────────────────────────────────────────────────────
  function handleSearch(q: string, tk = token, bid = businessId) {
    setSearch(q)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    if (!q.trim() || q.length < 2) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    searchTimeout.current = setTimeout(async () => {
      const res = await fetch(`/api/messages/search?q=${encodeURIComponent(q)}&businessId=${bid}`, { headers: { Authorization: `Bearer ${tk}` } })
      const data = await res.json()
      setSearchResults(data.results ?? [])
      setSearching(false)
    }, 300)
  }

  // ── Channels ─────────────────────────────────────────────────────────────
  async function loadChannels(tk: string) {
    setLoadingChannels(true)
    const res = await fetch('/api/messages/channels', { headers: { Authorization: `Bearer ${tk}` } })
    const data = await res.json()
    if (res.ok) {
      setBusinessId(data.businessId)
      setChannels(data.channels)
      if (data.channels.length > 0) openChannel(data.channels[0], tk, data.businessId)
      loadEmployees(data.businessId, tk)
    }
    setLoadingChannels(false)
  }

  // JAY-19 — owner creates a named group with hand-picked members.
  async function createGroup() {
    if (!newGroupName.trim() || newGroupMemberIds.length === 0 || creatingGroup) return
    setCreatingGroup(true)
    const res = await fetch('/api/messages/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: newGroupName.trim(), employeeIds: newGroupMemberIds }),
    })
    const data = await res.json()
    setCreatingGroup(false)
    if (res.ok) {
      setShowCreateGroup(false)
      setNewGroupName('')
      setNewGroupMemberIds([])
      await loadChannels(token)
    }
  }

  async function openChannel(ch: Channel, tk = token, bid = businessId) {
    setActiveChannel(ch)
    setThreadParent(null)
    setSendError(null)
    setLoadingThread(true)
    setMessages([])
    const res = await fetch(`/api/messages/thread?channel=${ch.id}&businessId=${bid}`, { headers: { Authorization: `Bearer ${tk}` } })
    const data = await res.json()
    if (res.ok) setMessages(data.messages)
    setLoadingThread(false)
    scrollToBottom('auto')
    if (ch.unreadCount > 0) {
      fetch('/api/messages/mark-read', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({ channel: ch.id, businessId: bid }) })
      setChannels(prev => prev.map(c => c.id === ch.id ? { ...c, unreadCount: 0, mentioned: false } : c))
    }
  }

  // ── Realtime ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!businessId) return
    const sub = supabase.channel(`chat:${businessId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `business_id=eq.${businessId}` }, (payload) => {
        const msg = payload.new as Message & { channel: string }
        setActiveChannel(ch => {
          if (ch?.id === msg.channel && !msg.parent_id) {
            setMessages(prev => [...prev, { ...msg, reactions: [], attachments: [], reply_count: 0 }])
            scrollToBottom()
          }
          // If this is a reply and we have the thread panel open for its parent
          if (msg.parent_id) {
            setThreadParent(tp => {
              if (tp?.id === msg.parent_id) {
                setThreadMessages(prev => [...prev, { ...msg, reactions: [], attachments: [] }])
                setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
                // Update reply count on parent
                setMessages(prev => prev.map(m => m.id === msg.parent_id ? { ...m, reply_count: (m.reply_count ?? 0) + 1 } : m))
              }
              return tp
            })
          }
          return ch
        })
        setChannels(prev => prev.map(c => {
          if (c.id === msg.channel && !msg.parent_id) {
            return { ...c, lastMessage: { sender_name: msg.sender_name, content: msg.content, created_at: msg.created_at }, unreadCount: msg.sender_id !== userId ? c.unreadCount + 1 : c.unreadCount }
          }
          return c
        }))
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [businessId, userId, scrollToBottom])

  // ── Send message ─────────────────────────────────────────────────────────
  async function send(parentId?: number) {
    const content = (parentId ? threadInput : input).trim()
    if (!content || sending || !activeChannel) return
    if (parentId) { setThreadInput('') } else { setInput('') }
    setSendError(null)
    setSending(true)

    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ channel: activeChannel.id, businessId, content, parentId: parentId ?? null, attachments: parentId ? [] : pendingFiles }),
      })
      if (!res.ok) {
        if (parentId) { setThreadInput(content) } else { setInput(content) }
        setSendError({ parentId, message: "Didn't send — server error" })
        return
      }
      const data = await res.json()
      if (!parentId) {
        setMessages(prev => [...prev, data.message])
        setPendingFiles([])
        scrollToBottom()
        setChannels(prev => prev.map(c => c.id === activeChannel.id ? { ...c, lastMessage: { sender_name: data.message.sender_name, content: data.message.content, created_at: data.message.created_at } } : c))
      } else {
        setThreadMessages(prev => [...prev, data.message])
        setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
        setMessages(prev => prev.map(m => m.id === parentId ? { ...m, reply_count: (m.reply_count ?? 0) + 1 } : m))
      }
    } catch {
      if (parentId) { setThreadInput(content) } else { setInput(content) }
      setSendError({ parentId, message: "Didn't send — network dropped" })
    } finally {
      setSending(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  // ── React ────────────────────────────────────────────────────────────────
  async function toggleReaction(msgId: number, reaction: string, inThread = false) {
    setReactionPickerMsgId(null)
    const res = await fetch('/api/messages/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageId: msgId, businessId, reaction }),
    })
    if (!res.ok) return
    const { toggled } = await res.json()

    const updateMsg = (msg: Message): Message => {
      const reactions = msg.reactions ? [...msg.reactions] : []
      const idx = reactions.findIndex(r => r.reaction === reaction)
      if (toggled === 'on') {
        if (idx >= 0) { reactions[idx] = { ...reactions[idx], count: reactions[idx].count + 1, reacted: true, users: [...reactions[idx].users, 'You'] } }
        else reactions.push({ reaction, count: 1, reacted: true, users: ['You'] })
      } else {
        if (idx >= 0) {
          const updated = { ...reactions[idx], count: reactions[idx].count - 1, reacted: false, users: reactions[idx].users.filter(u => u !== 'You') }
          if (updated.count <= 0) { reactions.splice(idx, 1) } else { reactions[idx] = updated }
        }
      }
      return { ...msg, reactions }
    }

    if (inThread) setThreadMessages(prev => prev.map(m => m.id === msgId ? updateMsg(m) : m))
    else setMessages(prev => prev.map(m => m.id === msgId ? updateMsg(m) : m))
  }

  // ── Edit ─────────────────────────────────────────────────────────────────
  async function submitEdit(msgId: number) {
    if (!editContent.trim()) return
    await fetch(`/api/messages/${msgId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content: editContent.trim() }),
    })
    const now = new Date().toISOString()
    const update = (m: Message) => m.id === msgId ? { ...m, content: editContent.trim(), edited_at: now } : m
    setMessages(prev => prev.map(update))
    setThreadMessages(prev => prev.map(update))
    setEditingMsgId(null)
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  async function deleteMsg(msgId: number, inThread = false) {
    await fetch(`/api/messages/${msgId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    const update = (m: Message) => m.id === msgId ? { ...m, is_deleted: true } : m
    if (inThread) setThreadMessages(prev => prev.map(update))
    else setMessages(prev => prev.map(update))
  }

  // ── Pin ───────────────────────────────────────────────────────────────────
  async function pinMsg(msgId: number, pin: boolean) {
    await fetch('/api/messages/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messageId: msgId, pin }),
    })
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_pinned: pin } : m))
  }

  // ── Thread panel ──────────────────────────────────────────────────────────
  async function openThread(msg: Message) {
    setThreadParent(msg)
    setLoadingThreadPanel(true)
    setThreadMessages([])
    const res = await fetch(`/api/messages/replies?parentId=${msg.id}&businessId=${businessId}`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await res.json()
    if (res.ok) setThreadMessages(data.messages)
    setLoadingThreadPanel(false)
    setTimeout(() => threadBottomRef.current?.scrollIntoView({ behavior: 'auto' }), 100)
  }

  // ── File upload ───────────────────────────────────────────────────────────
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('businessId', businessId)
    const res = await fetch('/api/messages/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
    if (res.ok) {
      const data = await res.json()
      setPendingFiles(prev => [...prev, data])
    }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── @mention autocomplete ─────────────────────────────────────────────────
  function handleInputChange(val: string) {
    setInput(val)
    setSendError(prev => (prev && prev.parentId === undefined ? null : prev))
    const atIdx = val.lastIndexOf('@')
    if (atIdx >= 0 && atIdx === val.length - 1 || (atIdx >= 0 && !val.slice(atIdx + 1).includes(' '))) {
      const query = val.slice(atIdx + 1).toLowerCase()
      if (employees.some(e => e.name.toLowerCase().includes(query))) {
        setMentionQuery(query)
        setMentionIndex(0)
        return
      }
    }
    setMentionQuery(null)
  }

  function selectMention(name: string) {
    const atIdx = input.lastIndexOf('@')
    setInput(input.slice(0, atIdx) + `@${name} `)
    setMentionQuery(null)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const filteredEmployees = mentionQuery !== null ? employees.filter(e => e.name.toLowerCase().includes(mentionQuery)) : []

  const pinnedMsgs = messages.filter(m => m.is_pinned && !m.is_deleted)
  const totalUnread = channels.reduce((s, c) => s + c.unreadCount, 0)

  // ── Message bubble ────────────────────────────────────────────────────────
  function MsgBubble({ msg, inThread = false }: { msg: Message; inThread?: boolean }) {
    const isMe = msg.sender_id === userId
    const isHovered = hoveredMsgId === msg.id
    const isEditing = editingMsgId === msg.id
    const showReactionPicker = reactionPickerMsgId === msg.id

    return (
      <div
        style={{ position: 'relative', display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: '6px' }}
        onMouseEnter={() => setHoveredMsgId(msg.id)}
        onMouseLeave={() => { setHoveredMsgId(null); setReactionPickerMsgId(null); setMoreEmojiOpen(false) }}
      >
        {!isMe && (
          <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'rgba(29,78,216,0.18)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700, flexShrink: 0, marginRight: '8px', alignSelf: 'flex-end' }}>
            {msg.sender_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ maxWidth: '68%' }}>
          {/* Hover action toolbar */}
          {isHovered && !isEditing && !msg.is_deleted && (
            <div style={{ position: 'absolute', top: -34, right: isMe ? 0 : 'auto', left: isMe ? 'auto' : 38, display: 'flex', gap: '4px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '8px', padding: '4px 6px', boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 10 }}>
              {/* Reaction trigger */}
              <button title="React" onClick={() => { setReactionPickerMsgId(showReactionPicker ? null : msg.id); setMoreEmojiOpen(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
              </button>
              {/* Reply */}
              {!inThread && (
                <button title="Reply in thread" onClick={() => openThread(msg)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                </button>
              )}
              {/* Edit — own messages only */}
              {isMe && (
                <button title="Edit" onClick={() => { setEditingMsgId(msg.id); setEditContent(msg.content) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
              )}
              {/* Delete — own messages only */}
              {isMe && (
                <button title="Delete" onClick={() => deleteMsg(msg.id, inThread)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              )}
              {/* Pin — owner only */}
              {isOwner && !inThread && (
                <button title={msg.is_pinned ? 'Unpin' : 'Pin'} onClick={() => pinMsg(msg.id, !msg.is_pinned)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: msg.is_pinned ? 'var(--accent)' : 'var(--text-secondary)', padding: '2px 4px', borderRadius: '4px', display: 'flex', alignItems: 'center' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
                </button>
              )}
            </div>
          )}

          {/* Reaction picker — 4 quick-react icons unchanged (fast path), plus a "+" that
              opens a free-form emoji grid. message_reactions.reaction is already free text
              (see messaging_features.sql), so any emoji here stores with no backend change. */}
          {showReactionPicker && (
            <div style={{ position: 'absolute', top: -72, right: isMe ? 0 : 'auto', left: isMe ? 'auto' : 38, display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', padding: '6px 10px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', zIndex: 20 }}>
              <div style={{ display: 'flex', gap: '6px' }}>
                {REACTIONS.map(r => (
                  <button key={r.key} title={r.label} onClick={() => toggleReaction(msg.id, r.key, inThread)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px 6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {r.icon}
                  </button>
                ))}
                <button title="More reactions" onClick={() => setMoreEmojiOpen(v => !v)} style={{ background: moreEmojiOpen ? 'rgba(59,130,246,0.15)' : 'none', border: 'none', cursor: 'pointer', color: moreEmojiOpen ? 'var(--accent)' : 'var(--text-secondary)', padding: '4px 6px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, lineHeight: 1 }}>
                  +
                </button>
              </div>
              {moreEmojiOpen && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '2px', borderTop: '1px solid var(--border)', paddingTop: '6px', maxWidth: '168px' }}>
                  {MORE_EMOJIS.map(e => (
                    <button key={e} onClick={() => { toggleReaction(msg.id, e, inThread); setMoreEmojiOpen(false) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px', borderRadius: '6px', lineHeight: 1 }}>
                      {e}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Message content */}
          {msg.is_deleted ? (
            <div style={{ padding: '8px 12px', borderRadius: '10px', background: 'var(--bg-input)', color: 'var(--text-tertiary)', fontSize: '13px', fontStyle: 'italic', border: '1px solid var(--border)' }}>
              This message was deleted
            </div>
          ) : isEditing ? (
            <div>
              <textarea value={editContent} onChange={e => setEditContent(e.target.value)} autoFocus
                style={{ width: '100%', padding: '8px 12px', borderRadius: '10px', border: '1.5px solid var(--accent)', fontSize: '14px', fontFamily: 'inherit', resize: 'none', outline: 'none', lineHeight: 1.5, background: 'var(--bg-input)', color: 'var(--text)' }}
                rows={2}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(msg.id) } if (e.key === 'Escape') setEditingMsgId(null) }}
              />
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                <button onClick={() => submitEdit(msg.id)} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', background: 'var(--accent)', color: 'var(--accent-text)', border: 'none', cursor: 'pointer' }}>Save</button>
                <button onClick={() => setEditingMsgId(null)} style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '6px', background: 'var(--bg-input)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ padding: '9px 13px', borderRadius: isMe ? '14px 14px 4px 14px' : '4px 14px 14px 14px', background: isMe ? 'var(--accent)' : 'var(--bg-input)', color: isMe ? 'var(--accent-text)' : 'var(--text)', fontSize: '14px', lineHeight: 1.5, border: isMe ? 'none' : '1px solid var(--border)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {renderContent(msg.content)}
              {msg.attachments?.map((att, i) => (
                <div key={i} style={{ marginTop: '8px' }}>
                  {isImage(att.file_type) ? (
                    <img src={att.url} alt={att.file_name} style={{ maxWidth: '240px', maxHeight: '180px', borderRadius: '8px', display: 'block' }} />
                  ) : (
                    <a href={att.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', background: isMe ? 'rgba(255,255,255,0.15)' : 'var(--bg-input)', borderRadius: '8px', textDecoration: 'none', color: isMe ? 'var(--accent-text)' : 'var(--accent)', fontSize: '12px' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                      <span>{att.file_name}</span>
                      <span style={{ opacity: 0.7 }}>{fmtBytes(att.file_size)}</span>
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Timestamp + edited */}
          {!msg.is_deleted && (
            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '3px', textAlign: isMe ? 'right' : 'left', paddingLeft: isMe ? 0 : '2px', paddingRight: isMe ? '2px' : 0 }}>
              {fmtTime(msg.created_at)}{msg.edited_at ? ' · edited' : ''}
            </div>
          )}

          {/* Reactions */}
          {!msg.is_deleted && msg.reactions && msg.reactions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
              {msg.reactions.map(r => (
                <button key={r.reaction} onClick={() => toggleReaction(msg.id, r.reaction, inThread)} title={r.users.join(', ')}
                  style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '99px', border: `1px solid ${r.reacted ? 'var(--accent)' : 'var(--border)'}`, background: r.reacted ? 'rgba(29,78,216,0.15)' : 'var(--bg-input)', cursor: 'pointer', fontSize: '12px', color: r.reacted ? 'var(--accent)' : 'var(--text-secondary)' }}>
                  {REACTIONS.find(rx => rx.key === r.reaction)?.icon ?? <span style={{ fontSize: '13px', lineHeight: 1 }}>{r.reaction}</span>}
                  <span>{r.count}</span>
                </button>
              ))}
            </div>
          )}

          {/* Reply count */}
          {!msg.is_deleted && !inThread && (msg.reply_count ?? 0) > 0 && (
            <button onClick={() => openThread(msg)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '12px', padding: '4px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
              {msg.reply_count} {msg.reply_count === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>
    )
  }

  useEffect(() => {
    if (messages.length > 0) scrollToBottom('auto')
  }, [activeChannel?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const grouped = groupByDate(messages)

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="dash-wrap">
      <Nav active="messages" />

      <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)' }}>

        {/* ── Sidebar ── */}
        <div style={{ width: '260px', flexShrink: 0, background: 'var(--bg-elevated)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
              <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)' }}>Messages</div>
              {totalUnread > 0 && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{totalUnread} unread</div>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-input)', borderRadius: '8px', padding: '6px 10px', border: '1px solid var(--border)' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input value={search} onChange={e => handleSearch(e.target.value)} placeholder="Search messages…" style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '13px', outline: 'none', color: 'var(--text)' }} />
              {search && <button onClick={() => { setSearch(''); setSearchResults([]) }} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0, display: 'flex' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
            </div>
            {/* JAY-19 — owner-only manual group creation. */}
            {isOwner && (
              <button
                onClick={() => setShowCreateGroup(true)}
                style={{ width: '100%', marginTop: '8px', background: 'rgba(59,130,246,0.1)', border: '1px dashed rgba(59,130,246,0.35)', borderRadius: '8px', color: 'var(--accent)', fontSize: '12px', fontWeight: 600, padding: '7px 10px', cursor: 'pointer', textAlign: 'left' }}
              >
                + New group
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {search.length >= 2 ? (
              searching ? <div style={{ padding: '2rem', textAlign: 'center', fontSize: '13px', color: 'var(--text-tertiary)' }}>Searching…</div>
              : searchResults.length === 0 ? <div style={{ padding: '2rem', textAlign: 'center', fontSize: '13px', color: 'var(--text-tertiary)' }}>No results for "{search}"</div>
              : searchResults.map(result => {
                const ch = channels.find(c => c.id === result.channel)
                const idx = result.content.toLowerCase().indexOf(search.toLowerCase())
                const start = Math.max(0, idx - 30)
                const snippet = (start > 0 ? '…' : '') + result.content.slice(start, idx + search.length + 40) + (idx + search.length + 40 < result.content.length ? '…' : '')
                return (
                  <div key={result.id} onClick={() => { if (ch) { openChannel(ch); setSearch(''); setSearchResults([]) } }}
                    style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-input)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)' }}>{ch?.name ?? result.channel}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{timeAgo(result.created_at)}</div>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '2px', fontWeight: 500 }}>{result.sender_name}</div>
                    <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snippet}</div>
                  </div>
                )
              })
            ) : loadingChannels ? <div style={{ padding: '2rem', textAlign: 'center', fontSize: '13px', color: 'var(--text-tertiary)' }}>Loading…</div>
            : channels.map(ch => (
              <div key={ch.id} onClick={() => openChannel(ch)}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', cursor: 'pointer', background: activeChannel?.id === ch.id ? 'rgba(29,78,216,0.14)' : 'transparent', borderLeft: `3px solid ${activeChannel?.id === ch.id ? 'var(--accent)' : 'transparent'}`, transition: 'background 0.1s' }}
                onMouseEnter={e => { if (activeChannel?.id !== ch.id) (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-input)' }}
                onMouseLeave={e => { if (activeChannel?.id !== ch.id) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}>
                <div style={{ width: 38, height: 38, borderRadius: ch.type === 'group' ? '10px' : '50%', background: ch.type === 'group' ? 'var(--accent)' : 'rgba(29,78,216,0.18)', color: ch.type === 'group' ? 'var(--accent-text)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>
                  {ch.type === 'group' ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                  : ch.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <div style={{ fontSize: '13px', fontWeight: ch.unreadCount > 0 ? 700 : 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.name}</div>
                    {ch.lastMessage && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0, marginLeft: '6px' }}>{timeAgo(ch.lastMessage.created_at)}</div>}
                  </div>
                  {ch.lastMessage ? <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.lastMessage.sender_name}: {ch.lastMessage.content}</div>
                  : <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No messages yet</div>}
                </div>
                {ch.mentioned ? (
                  <div title="You were mentioned" style={{ height: 18, borderRadius: '99px', background: 'var(--amber)', color: 'var(--accent-text)', fontSize: '10px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 7px', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.03em' }}>@ mentioned</div>
                ) : ch.unreadCount > 0 && (
                  <div style={{ minWidth: 18, height: 18, borderRadius: '99px', background: 'var(--accent)', color: 'var(--accent-text)', fontSize: '11px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 }}>{ch.unreadCount}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Main thread ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Channel header */}
          {activeChannel && (
            <div style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', padding: '0 1.5rem', height: '56px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: activeChannel.type === 'group' ? '8px' : '50%', background: activeChannel.type === 'group' ? 'var(--accent)' : 'rgba(29,78,216,0.18)', color: activeChannel.type === 'group' ? 'var(--accent-text)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 700 }}>
                {activeChannel.type === 'group' ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                : activeChannel.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>{activeChannel.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{activeChannel.type === 'group' ? 'Team group chat' : 'Direct message'}</div>
              </div>
              {threadParent && <button onClick={() => setThreadParent(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '12px', padding: '4px 8px', borderRadius: '6px' }}>Close thread</button>}
            </div>
          )}

          {/* Pinned message banner */}
          {pinnedMsgs.length > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.28)', padding: '8px 1.5rem', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17z"/></svg>
              <div style={{ flex: 1, fontSize: '12px', color: 'var(--amber)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>Pinned:</strong> {pinnedMsgs[pinnedMsgs.length - 1].content}
              </div>
              {pinnedMsgs.length > 1 && <span style={{ fontSize: '11px', color: 'var(--amber)' }}>+{pinnedMsgs.length - 1} more</span>}
            </div>
          )}

          {/* Messages area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
            {!activeChannel ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', fontSize: '14px' }}>Select a conversation</div>
            ) : loadingThread ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', fontSize: '14px' }}>Loading…</div>
            ) : messages.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', gap: '10px' }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <div style={{ fontSize: '14px' }}>No messages yet. Say hello!</div>
              </div>
            ) : (
              grouped.map(group => (
                <div key={group.date}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '1.25rem 0 1rem' }}>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500, whiteSpace: 'nowrap' }}>{group.date}</div>
                    <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
                  </div>
                  {group.messages.map((msg, i) => {
                    const prevMsg = i > 0 ? group.messages[i - 1] : null
                    const showName = msg.sender_id !== userId && prevMsg?.sender_id !== msg.sender_id
                    return (
                      <div key={msg.id} style={{ marginBottom: '6px', marginTop: showName ? '12px' : '0' }}>
                        {showName && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '4px', marginLeft: '38px' }}>{msg.sender_name}</div>}
                        <MsgBubble msg={msg} />
                      </div>
                    )
                  })}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Pending file previews */}
          {pendingFiles.length > 0 && (
            <div style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', padding: '8px 1.5rem', display: 'flex', gap: '8px', flexWrap: 'wrap', flexShrink: 0 }}>
              {pendingFiles.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(29,78,216,0.12)', border: '1px solid rgba(29,78,216,0.3)', borderRadius: '8px', padding: '6px 10px', fontSize: '12px' }}>
                  <span style={{ color: 'var(--accent)' }}>{f.file_name}</span>
                  <span style={{ color: 'var(--text-tertiary)' }}>{fmtBytes(f.file_size)}</span>
                  <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 0, display: 'flex' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input */}
          {activeChannel && (
            <div style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)', padding: '1rem 1.5rem', flexShrink: 0, position: 'relative' }}>
              {/* @mention dropdown */}
              {mentionQuery !== null && filteredEmployees.length > 0 && (
                <div style={{ position: 'absolute', bottom: '100%', left: '1.5rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '10px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)', overflow: 'hidden', zIndex: 50, minWidth: '180px' }}>
                  {filteredEmployees.map((emp, i) => (
                    <div key={emp.id} onClick={() => selectMention(emp.name)}
                      style={{ padding: '9px 14px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, background: i === mentionIndex ? 'rgba(29,78,216,0.15)' : 'transparent', color: 'var(--text)' }}
                      onMouseEnter={() => setMentionIndex(i)}>
                      @{emp.name}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', background: 'var(--bg-input)', borderRadius: '12px', padding: '8px 12px', border: '1px solid var(--border)' }}>
                {/* File attach button */}
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  style={{ width: 30, height: 30, borderRadius: '6px', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {uploading ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>}
                </button>
                <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileSelect} />
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => handleInputChange(e.target.value)}
                  onKeyDown={e => {
                    if (mentionQuery !== null && filteredEmployees.length > 0) {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filteredEmployees.length - 1)); return }
                      if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return }
                      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(filteredEmployees[mentionIndex].name); return }
                      if (e.key === 'Escape') { setMentionQuery(null); return }
                    }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  }}
                  placeholder={`Message ${activeChannel.name}…`}
                  rows={1}
                  disabled={sending}
                  style={{ flex: 1, resize: 'none', fontSize: '14px', padding: '4px 2px', border: 'none', background: 'transparent', fontFamily: 'inherit', outline: 'none', lineHeight: 1.5, maxHeight: '120px', overflowY: 'auto', color: 'var(--text)' }}
                  onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 120)}px` }}
                />
                <button onClick={() => send()} disabled={sending || (!input.trim() && pendingFiles.length === 0)}
                  style={{ width: 34, height: 34, borderRadius: '8px', border: 'none', flexShrink: 0, background: (input.trim() || pendingFiles.length > 0) && !sending ? 'var(--accent)' : 'var(--bg-input)', color: 'var(--accent-text)', cursor: (input.trim() || pendingFiles.length > 0) && !sending ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
              {sendError && sendError.parentId === undefined ? (
                <div style={{ fontSize: '12px', color: 'var(--error)', marginTop: '5px', textAlign: 'center' }}>
                  {sendError.message}
                  {' · '}
                  <button onClick={() => send()} disabled={sending} style={{ fontSize: '12px', color: 'var(--error)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}>Retry</button>
                </div>
              ) : (
                <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '5px', textAlign: 'center' }}>Enter to send · Shift+Enter for new line</div>
              )}
            </div>
          )}
        </div>

        {/* ── Thread panel ── */}
        {threadParent && (
          <div style={{ width: '320px', flexShrink: 0, background: 'var(--bg-elevated)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text)' }}>Thread</div>
              <button onClick={() => setThreadParent(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Parent message */}
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-input)' }}>
              <MsgBubble msg={threadParent} inThread />
            </div>

            {/* Thread replies */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
              {loadingThreadPanel ? (
                <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-tertiary)', paddingTop: '1rem' }}>Loading…</div>
              ) : threadMessages.length === 0 ? (
                <div style={{ textAlign: 'center', fontSize: '13px', color: 'var(--text-tertiary)', paddingTop: '1rem' }}>No replies yet</div>
              ) : threadMessages.map((msg, i) => {
                const prevMsg = i > 0 ? threadMessages[i - 1] : null
                const showName = msg.sender_id !== userId && prevMsg?.sender_id !== msg.sender_id
                return (
                  <div key={msg.id} style={{ marginBottom: '6px', marginTop: showName ? '12px' : '0' }}>
                    {showName && <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '4px', marginLeft: '38px' }}>{msg.sender_name}</div>}
                    <MsgBubble msg={msg} inThread />
                  </div>
                )
              })}
              <div ref={threadBottomRef} />
            </div>

            {/* Thread reply input */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '0.75rem 1.25rem', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', background: 'var(--bg-input)', borderRadius: '10px', padding: '6px 10px', border: '1px solid var(--border)' }}>
                <textarea
                  value={threadInput}
                  onChange={e => { setThreadInput(e.target.value); setSendError(prev => (prev && prev.parentId === threadParent.id ? null : prev)) }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(threadParent.id) } }}
                  placeholder="Reply…"
                  rows={1}
                  style={{ flex: 1, resize: 'none', fontSize: '13px', padding: '3px 2px', border: 'none', background: 'transparent', fontFamily: 'inherit', outline: 'none', lineHeight: 1.5, maxHeight: '80px', overflowY: 'auto', color: 'var(--text)' }}
                  onInput={e => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = `${Math.min(t.scrollHeight, 80)}px` }}
                />
                <button onClick={() => send(threadParent.id)} disabled={sending || !threadInput.trim()}
                  style={{ width: 30, height: 30, borderRadius: '6px', border: 'none', background: threadInput.trim() && !sending ? 'var(--accent)' : 'var(--bg-input)', color: 'var(--accent-text)', cursor: threadInput.trim() && !sending ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                </button>
              </div>
              {sendError && sendError.parentId === threadParent.id && (
                <div style={{ fontSize: '12px', color: 'var(--error)', marginTop: '5px', textAlign: 'center' }}>
                  {sendError.message}
                  {' · '}
                  <button onClick={() => send(threadParent.id)} disabled={sending} style={{ fontSize: '12px', color: 'var(--error)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}>Retry</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── JAY-19: CREATE GROUP MODAL ── */}
      {showCreateGroup && (
        <div
          onClick={() => setShowCreateGroup(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem', width: '340px', maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)', marginBottom: '1rem' }}>New group</div>

            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Group name</label>
            <input
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              placeholder="e.g. Managers, Kitchen"
              style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text)', padding: '8px 10px', fontSize: '13px', marginBottom: '0.75rem' }}
            />

            <label style={{ fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Members</label>
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '8px', marginBottom: '1rem', maxHeight: '220px' }}>
              {employees.length === 0 ? (
                <div style={{ padding: '0.75rem', fontSize: '12px', color: 'var(--text-tertiary)' }}>No employees found.</div>
              ) : employees.map(emp => {
                const checked = newGroupMemberIds.includes(emp.id)
                return (
                  <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', fontSize: '13px', color: 'var(--text)', cursor: 'pointer', borderBottom: '1px solid var(--border)' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setNewGroupMemberIds(prev => checked ? prev.filter(id => id !== emp.id) : [...prev, emp.id])}
                      style={{ width: '16px', height: '16px', flexShrink: 0 }}
                    />
                    {emp.name}
                  </label>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowCreateGroup(false)}
                style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '13px', padding: '8px 14px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={createGroup}
                disabled={creatingGroup || !newGroupName.trim() || newGroupMemberIds.length === 0}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: '8px', color: 'var(--accent-text)', fontSize: '13px', padding: '8px 14px', cursor: creatingGroup ? 'default' : 'pointer', opacity: creatingGroup || !newGroupName.trim() || newGroupMemberIds.length === 0 ? 0.6 : 1 }}
              >
                {creatingGroup ? 'Creating…' : 'Create group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
