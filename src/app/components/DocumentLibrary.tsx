'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { FileIcon } from './Icons'
import { useToast } from './Toast'
import ConfirmDeleteModal from './ConfirmDeleteModal'

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
  const { showToast } = useToast()
  const [docs, setDocs] = useState<Doc[]>([])
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [confirmDoc, setConfirmDoc] = useState<Doc | null>(null)

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
      showToast('File must be under 10MB.', 'error')
      return
    }
    setUploading(true)

    const filePath = `templates/${userId}/${Date.now()}_${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file)

    if (uploadError) {
      showToast('Upload failed. Try again.', 'error')
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
      showToast('Error saving file record.', 'error')
    } else {
      await loadDocs()
    }
    setUploading(false)
    e.target.value = ''
  }

  async function handleDelete(doc: Doc) {
    setConfirmDoc(null)
    setDeletingId(doc.id)
    try {
      await supabase.storage.from('documents').remove([doc.file_path])
      await supabase.from('document_templates').delete().eq('id', doc.id)
      setDocs(prev => prev.filter(d => d.id !== doc.id))
    } catch {
      showToast('Delete failed. Try again.', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  const filteredDocs = search.trim()
    ? docs.filter(d => d.file_name.toLowerCase().includes(search.trim().toLowerCase()))
    : docs

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

      <div className="context-bar" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
        Documents uploaded here (W-4, I-9, handbook, etc.) will automatically appear in every employee's onboarding link.
      </div>

      {docs.length > 0 && (
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search documents..."
          style={{ width: '100%', fontSize: '13px', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: '7px', marginBottom: '0.75rem', boxSizing: 'border-box' }}
        />
      )}

      {docs.length === 0 ? (
        <div className="empty-state">No documents yet — upload your standard forms above.</div>
      ) : filteredDocs.length === 0 ? (
        <div className="empty-state">No documents match "{search}".</div>
      ) : (
        <div className="upload-list">
          {filteredDocs.map(doc => (
            <div key={doc.id} className="upload-item">
              <div className="upload-icon"><FileIcon size={16} color="var(--accent)" /></div>
              <div style={{ flex: 1 }}>
                <div className="upload-name">{doc.file_name}</div>
                <div className="upload-meta">{formatSize(doc.file_size)}</div>
              </div>
              <button
                className="doc-btn"
                style={{ color: 'var(--error)' }}
                onClick={() => setConfirmDoc(doc)}
                disabled={deletingId === doc.id}
              >
                {deletingId === doc.id ? 'Removing...' : 'Remove'}
              </button>
            </div>
          ))}
        </div>
      )}

      {confirmDoc && (
        <ConfirmDeleteModal
          title={`Delete ${confirmDoc.file_name}?`}
          message={<>This can&apos;t be undone. Type <strong style={{ color: 'var(--text)' }}>{confirmDoc.file_name}</strong> to confirm.</>}
          confirmValue={confirmDoc.file_name}
          confirmLabel="Delete document"
          onConfirm={() => handleDelete(confirmDoc)}
          onCancel={() => setConfirmDoc(null)}
        />
      )}
    </div>
  )
}
