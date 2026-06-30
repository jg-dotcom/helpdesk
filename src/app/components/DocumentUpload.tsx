'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

type EmployeeDoc = {
  id: number
  file_name: string
  file_path: string
  file_size: number
  created_at: string
}

type Props = {
  employeeId: number
  employeeName: string
  userId: string
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentUpload({ employeeId, employeeName, userId }: Props) {
  const [docs, setDocs] = useState<EmployeeDoc[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDocs()
  }, [employeeId])

  async function loadDocs() {
    const { data } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', employeeId)
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
    const filePath = `${userId}/${employeeId}/${Date.now()}_${file.name}`
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(filePath, file)
    if (uploadError) {
      setError('Upload failed. Try again.')
      setUploading(false)
      return
    }
    const { error: dbError } = await supabase.from('employee_documents').insert([{
      user_id: userId,
      employee_id: employeeId,
      employee_name: employeeName,
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

  async function handleDownload(doc: EmployeeDoc) {
    const { data } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.file_path, 60)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function handleDelete(doc: EmployeeDoc) {
    await supabase.storage.from('documents').remove([doc.file_path])
    await supabase.from('employee_documents').delete().eq('id', doc.id)
    setDocs(prev => prev.filter(d => d.id !== doc.id))
  }

  return (
    <div className="doc-upload">
      <div className="doc-upload-header">
        <div className="section-label">Documents to sign</div>
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

      {error && <div className="auth-error">{error}</div>}

      {docs.length === 0 ? (
        <div className="empty-state">No documents yet — upload a W-4, I-9, or any form that needs signing.</div>
      ) : (
        <div className="upload-list">
          {docs.map(doc => (
            <div key={doc.id} className="upload-item">
              <div className="upload-icon">📄</div>
              <div style={{ flex: 1 }}>
                <div className="upload-name">{doc.file_name}</div>
                <div className="upload-meta">{formatSize(doc.file_size)}</div>
              </div>
              <button className="doc-btn" onClick={() => handleDownload(doc)}>Download</button>
              <button className="doc-btn" style={{ color: '#c0392b' }} onClick={() => handleDelete(doc)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
