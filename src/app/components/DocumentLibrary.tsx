'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type Doc = {
  id: number
  file_name: string
  file_path: string
  file_size: number
  created_at: string
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentLibrary({ userId }: { userId: string }) {
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDocs()
  }, [userId])

  async function loadDocs() {
    const { data } = await supabase
      .from('document_templates')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (data) setDocs(data)
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB.')
      return
    }
    setUploading(true)
    setError('')

    const filePath = `templates/${userId}/${Date.now()}_${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file)

    if (uploadError) {
      setError('Upload failed. Try again.')
      setUploading(false)
      return
    }

    const { error: dbError } = await supabase.from('document_templates').insert([{
      user_id: userId,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
    }])

    if (dbError) {
      setError('Error saving file record.')
    } else {
      await loadDocs()
    }
    setUploading(false)
    e.target.value = ''
  }

  async function handleDelete(doc: Doc) {
    await supabase.storage.from('documents').remove([doc.file_path])
    await supabase.from('document_templates').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div className="doc-upload-header">
        <div className="section-label">Document library</div>
        <label className="btn-ghost upload-label">
          {uploading ? 'Uploading...' : '+ Add document'}
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={handleUpload}
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      <div className="context-bar" style={{ background: '#f7f7f5', color: '#6b6b6b', marginBottom: '1rem' }}>
        Documents uploaded here (W-4, I-9, handbook, etc.) will automatically appear in every employee's onboarding link.
      </div>

      {error && <div className="auth-error">{error}</div>}

      {docs.length === 0 ? (
        <div className="empty-state">No documents yet — upload your standard forms above.</div>
      ) : (
        <div className="upload-list">
          {docs.map(doc => (
            <div key={doc.id} className="upload-item">
              <div className="upload-icon">📄</div>
              <div style={{ flex: 1 }}>
                <div className="upload-name">{doc.file_name}</div>
                <div className="upload-meta">{formatSize(doc.file_size)}</div>
              </div>
              <button
                className="doc-btn"
                style={{ color: '#c0392b' }}
                onClick={() => handleDelete(doc)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
