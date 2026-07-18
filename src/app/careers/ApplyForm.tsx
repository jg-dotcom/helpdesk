'use client'

import { useState, useRef } from 'react'
import { useToast } from '../components/Toast'

type Props = { jobId: string; jobTitle: string; ownerId: string }

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx']
const MAX_SIZE = 10 * 1024 * 1024 // 10MB

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function ApplyForm({ jobId, jobTitle, ownerId }: Props) {
  const { showToast } = useToast()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [coverLetter, setCoverLetter] = useState('')
  const [source, setSource] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  // JAY-133 — drag-and-drop resume upload. States: empty / uploading /
  // done (path set) / error. The file itself lands in the private
  // 'resumes' bucket via a separate upload before the main application
  // submit — resume_path is just a storage key at that point, never a
  // public URL (see GET /api/applications/[id]/resume for how the owner
  // views it later).
  const [resumeState, setResumeState] = useState<'empty' | 'uploading' | 'done' | 'error'>('empty')
  const [resumeFileName, setResumeFileName] = useState('')
  const [resumeFileSize, setResumeFileSize] = useState(0)
  const [resumePath, setResumePath] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function uploadResume(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setResumeState('error')
      setResumeError('Please upload a PDF, DOC, or DOCX file.')
      return
    }
    if (file.size > MAX_SIZE) {
      setResumeState('error')
      setResumeError('That file is over 10MB — try a smaller or compressed version.')
      return
    }

    setResumeState('uploading')
    setResumeError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('job_posting_id', jobId)
      const res = await fetch('/api/applications/upload-resume', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) {
        setResumeState('error')
        setResumeError(data.error || 'Upload failed. Please try again.')
        return
      }
      setResumePath(data.path)
      setResumeFileName(data.fileName)
      setResumeFileSize(data.fileSize)
      setResumeState('done')
    } catch {
      setResumeState('error')
      setResumeError("Couldn't upload your resume. Check your connection and try again.")
    }
  }

  function removeResume() {
    setResumeState('empty')
    setResumePath(null)
    setResumeFileName('')
    setResumeFileSize(0)
    setResumeError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) uploadResume(file)
  }

  async function handleSubmit() {
    if (!name.trim() || !email.trim()) { showToast('Name and email are required.', 'error'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_posting_id: jobId, owner_id: ownerId, name: name.trim(), email: email.trim(), phone: phone.trim(),
          cover_letter: coverLetter.trim(), source: source || null,
          resume_path: resumePath, resume_file_name: resumePath ? resumeFileName : null,
        }),
      })
      if (!res.ok) { const d = await res.json(); showToast(d.error || "We couldn't submit your application. Please try again in a moment.", 'error'); setLoading(false); return }
      setDone(true)
    } catch {
      showToast("Couldn't submit your application. Check your connection and try again.", 'error')
    }
    setLoading(false)
  }

  // JAY-61 — dark-theme pass to match careers/[userId]/page.tsx.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          marginTop: '1rem', padding: '10px 20px', background: '#1d4ed8', color: '#fff',
          border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
        }}
      >
        Apply for this role
      </button>
    )
  }

  return (
    <div style={{ marginTop: '1.25rem', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '1.25rem' }}>
      {done ? (
        <div style={{ fontSize: '14px', color: '#4ade80', fontWeight: 600 }}>
          ✓ Application submitted! We'll be in touch.
        </div>
      ) : (
        <>
          <div style={{ fontSize: '15px', fontWeight: 700, marginBottom: '1rem', color: '#f1f5f9' }}>Apply — {jobTitle}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={lbl}>Full name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" style={inp} />
            </div>
            <div>
              <label style={lbl}>Email *</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" style={inp} />
            </div>
            <div>
              <label style={lbl}>Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 000-0000" style={inp} />
            </div>
            <div>
              <label style={lbl}>Cover letter / message</label>
              <textarea value={coverLetter} onChange={e => setCoverLetter(e.target.value)}
                placeholder="Tell us a bit about yourself..." rows={4}
                style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div>
              <label style={lbl}>How did you hear about us?</label>
              <select value={source} onChange={e => setSource(e.target.value)} style={{ ...inp, fontFamily: 'inherit' }}>
                <option value="">Prefer not to say</option>
                <option value="Referral">Employee referral</option>
                <option value="Job board">Job board (Indeed, LinkedIn, etc.)</option>
                <option value="Walk-in">Walk-in / in-store</option>
                <option value="Social media">Social media</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* JAY-133 — drag-and-drop resume upload, optional. */}
            <div>
              <label style={lbl}>Resume (optional)</label>
              <input ref={fileInputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadResume(f) }} />

              {resumeState === 'empty' && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragActive(true) }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleDrop}
                  style={{
                    border: `1.5px dashed ${dragActive ? '#3b82f6' : 'rgba(255,255,255,0.18)'}`,
                    borderRadius: '8px', padding: '1.25rem', textAlign: 'center', cursor: 'pointer',
                    background: dragActive ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
                    fontSize: '13px', color: '#94a3b8',
                  }}
                >
                  Drag and drop your resume, or click to browse<br />
                  <span style={{ fontSize: '11px', color: '#64748b' }}>PDF, DOC, or DOCX — up to 10MB</span>
                </div>
              )}

              {resumeState === 'uploading' && (
                <div style={{ border: '1.5px dashed rgba(255,255,255,0.18)', borderRadius: '8px', padding: '1.25rem', textAlign: 'center', fontSize: '13px', color: '#94a3b8' }}>
                  Uploading...
                </div>
              )}

              {resumeState === 'done' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', padding: '0.75rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#e2e8f0', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{resumeFileName}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{formatSize(resumeFileSize)}</div>
                  </div>
                  <button onClick={removeResume} type="button" style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                    Remove
                  </button>
                </div>
              )}

              {resumeState === 'error' && (
                <div>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    style={{ border: '1.5px dashed rgba(248,113,113,0.4)', borderRadius: '8px', padding: '1.25rem', textAlign: 'center', cursor: 'pointer', background: 'rgba(248,113,113,0.06)', fontSize: '13px', color: '#94a3b8' }}
                  >
                    Drag and drop your resume, or click to browse
                  </div>
                  <div style={{ fontSize: '12px', color: '#f87171', marginTop: '4px' }}>{resumeError}</div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={handleSubmit} disabled={loading || resumeState === 'uploading'} style={{
                padding: '10px 20px', background: '#1d4ed8', color: '#fff',
                border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                opacity: (loading || resumeState === 'uploading') ? 0.6 : 1,
              }}>
                {loading ? 'Submitting...' : 'Submit application'}
              </button>
              <button onClick={() => setOpen(false)} style={{
                padding: '10px 16px', background: 'rgba(255,255,255,0.05)', color: '#94a3b8',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '14px', cursor: 'pointer',
              }}>
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const lbl: React.CSSProperties = { fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '4px', fontWeight: 500 }
const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: '14px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '7px', outline: 'none', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', color: '#e2e8f0' }
