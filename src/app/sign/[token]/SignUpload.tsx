'use client'

import { useState } from 'react'

export default function SignUpload({ token }: { token: string }) {
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [done, setDone] = useState<string[]>([])

  const [signatureName, setSignatureName] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')
  const [signed, setSigned] = useState(false)

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setUploadError('File must be under 10MB.')
      return
    }
    setUploading(true)
    setUploadError('')

    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch(`/api/sign/${token}/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setUploadError(data.error || 'Upload failed. Try again.')
    } else {
      setDone(prev => [...prev, file.name])
    }
    setUploading(false)
    e.target.value = ''
  }

  async function handleAcknowledge() {
    if (!acknowledged) {
      setSignError('Please check the box to confirm you have read the welcome pack.')
      return
    }
    if (!signatureName.trim()) {
      setSignError('Please type your full name to sign.')
      return
    }
    setSigning(true)
    setSignError('')

    const res = await fetch(`/api/sign/${token}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signatureName: signatureName.trim() }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setSignError(data.error || 'Could not save signature. Try again.')
    } else {
      setSigned(true)
    }
    setSigning(false)
  }

  return (
    <>
      <div className="doc-upload" style={{ marginTop: '1rem' }}>
        <label className="btn upload-label">
          {uploading ? 'Uploading...' : '+ Upload document'}
          <input
            type="file"
            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
            onChange={handleUpload}
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>
        {uploadError && <div className="auth-error">{uploadError}</div>}
        {done.map((name, i) => (
          <div key={i} className="done-msg">✓ Uploaded {name}</div>
        ))}
      </div>

      <div className="sign-section-label" style={{ marginTop: '2rem' }}>Acknowledgment</div>

      {signed ? (
        <div className="done-msg" style={{ fontSize: '15px', padding: '1rem 0' }}>
          ✓ Signed by {signatureName}. You&apos;re all set!
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
            <input
              type="checkbox"
              id="ack"
              checked={acknowledged}
              onChange={e => setAcknowledged(e.target.checked)}
              style={{ marginTop: '3px', flexShrink: 0 }}
            />
            <label htmlFor="ack" style={{ fontSize: '14px', color: '#3a3a3a', lineHeight: 1.5 }}>
              I confirm that I have read and understood this welcome pack, and agree to the policies described above.
            </label>
          </div>
          <div className="field">
            <label>Type your full name to sign</label>
            <input
              value={signatureName}
              onChange={e => setSignatureName(e.target.value)}
              placeholder="Jane Smith"
            />
          </div>
          {signError && <div className="auth-error">{signError}</div>}
          <button className="btn" onClick={handleAcknowledge} disabled={signing} style={{ marginTop: '0.75rem' }}>
            {signing ? 'Saving...' : '✍ Sign & submit'}
          </button>
        </div>
      )}
    </>
  )
}
