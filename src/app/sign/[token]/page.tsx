import { supabaseAdmin } from '../../lib/supabaseAdmin'
import SignUpload, { TimeOffRequest } from './SignUpload'
import AvailabilityForm from './AvailabilityForm'
import W4Form from './W4Form'
import I9Form from './I9Form'

type EmployeeDoc = {
  id: number
  file_name: string
  file_size: number
  file_path: string
  created_at: string
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data: link } = await supabaseAdmin
    .from('onboarding_links')
    .select('employee_id, employee_name, welcome_pack, user_id')
    .eq('token', token)
    .single()

  if (!link) {
    return (
      <div className="sign-wrap">
        <div className="sign-card">
          <h1>Link not found</h1>
          <p>This link is invalid or has expired. Please ask your employer for a new one.</p>
        </div>
      </div>
    )
  }

  // Employee-specific docs
  const { data: empDocsRaw } = await supabaseAdmin
    .from('employee_documents')
    .select('id, file_name, file_size, file_path, created_at')
    .eq('employee_id', link.employee_id)
    .order('created_at', { ascending: false })

  // Standard docs from the owner's library
  const { data: templateDocsRaw } = await supabaseAdmin
    .from('document_templates')
    .select('id, file_name, file_size, file_path, created_at')
    .eq('user_id', link.user_id)
    .order('created_at', { ascending: false })

  const allDocs = [...(templateDocsRaw || []), ...(empDocsRaw || [])] as EmployeeDoc[]

  const docsWithUrls = await Promise.all(
    allDocs.map(async (doc) => {
      const { data: signed } = await supabaseAdmin.storage
        .from('documents')
        .createSignedUrl(doc.file_path, 600)
      return { ...doc, url: signed?.signedUrl || null }
    })
  )

  return (
    <div className="sign-wrap">
      <div className="sign-card">
        <div className="logo">help<span>desk</span></div>
        <h1>Welcome, {link.employee_name.split(' ')[0]}!</h1>

        {link.welcome_pack && (
          <div className="sign-pack">
            {link.welcome_pack.split('\n').map((line: string, i: number) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}

        <div className="sign-section-label">Documents to review & sign</div>
        {docsWithUrls.length === 0 ? (
          <div className="empty-state">No documents have been added yet.</div>
        ) : (
          <div className="upload-list">
            {docsWithUrls.map(doc => (
              <div key={doc.id} className="upload-item">
                <div className="upload-icon">📄</div>
                <div style={{ flex: 1 }}>
                  <div className="upload-name">{doc.file_name}</div>
                  <div className="upload-meta">{formatSize(doc.file_size)}</div>
                </div>
                {doc.url && (
                  <a className="doc-btn" href={doc.url} target="_blank" rel="noopener noreferrer">
                    Download
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
          <div className="sign-section-label">W-4 — Federal Tax Withholding</div>
          <W4Form token={token} employeeId={link.employee_id} userId={link.user_id} defaultName={link.employee_name} />
        </div>

        <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
          <div className="sign-section-label">I-9 — Employment Eligibility</div>
          <I9Form token={token} employeeId={link.employee_id} userId={link.user_id} defaultName={link.employee_name} />
        </div>

        <AvailabilityForm employeeId={link.employee_id} />
        <TimeOffRequest token={token} />

        <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
          <div className="sign-section-label">Return your completed documents</div>
        </div>
        <SignUpload token={token} />
      </div>
    </div>
  )
}
