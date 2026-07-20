'use client'

import { useState } from 'react'

const ghostBtn: React.CSSProperties = { fontSize: '12px', padding: '6px 12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }
const dangerBtn: React.CSSProperties = { fontSize: '13px', padding: '8px 14px', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.1)', color: 'var(--error)', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit' }

type Props = {
  title: string
  message: React.ReactNode
  confirmValue: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

// Shared type-to-confirm modal — extracted from EmployeePanel (JAY-125) so every
// destructive-delete flow gets the same UI instead of native window.confirm().
export default function ConfirmDeleteModal({ title, message, confirmValue, confirmLabel, onConfirm, onCancel }: Props) {
  const [text, setText] = useState('')
  const matches = text === confirmValue

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onCancel}>
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '1.5rem', width: '420px', maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text)', marginBottom: '0.6rem' }}>{title}</div>
        <div style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: '1rem' }}>
          {message}
        </div>
        <input
          autoFocus
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={confirmValue}
          style={{ width: '100%', boxSizing: 'border-box', marginBottom: '1rem', borderColor: text && !matches ? 'var(--error)' : undefined }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={ghostBtn}>Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!matches}
            style={{
              ...dangerBtn,
              opacity: matches ? 1 : 0.5,
              cursor: matches ? 'pointer' : 'default',
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
