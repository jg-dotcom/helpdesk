'use client'

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Employee } from '../page'
import ComplianceChecklist from './ComplianceChecklist'

type Props = {
  employee: Employee
  onClose: () => void
  onUpdated: (emp: Employee) => void
  onDelete: (id: number) => void
  onStartAction: (type: 'onboarding' | 'checkin' | 'offboarding') => void
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  on_leave: 'On leave',
  terminated: 'Terminated',
}

export default function EmployeePanel({ employee, onClose, onUpdated, onDelete, onStartAction }: Props) {
  const [form, setForm] = useState({ ...employee })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [welcomePackSent, setWelcomePackSent] = useState(false)
  const [documentsSigned, setDocumentsSigned] = useState(false)

  useEffect(() => {
    setForm({ ...employee })
    setSaveMsg('')
    loadComplianceData()
  }, [employee.id])

  async function loadComplianceData() {
    const { data } = await supabase
      .from('onboarding_links')
      .select('acknowledged_at')
      .eq('employee_id', employee.id)
      .order('created_at', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      setWelcomePackSent(true)
      setDocumentsSigned(!!data[0].acknowledged_at)
    } else {
      setWelcomePackSent(false)
      setDocumentsSigned(false)
    }
  }

  function set(field: keyof Employee, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function save() {
    setSaving(true)
    setSaveMsg('')
    const { error } = await supabase
      .from('employees')
      .update({
        name: form.name,
        role: form.role,
        start: form.start,
        type: form.type,
        phone: form.phone,
        email: form.email,
        address: form.address,
        emergency_contact: form.emergency_contact,
        ssn_last4: form.ssn_last4,
        date_of_birth: form.date_of_birth,
        status: form.status,
        i9_status: form.i9_status,
        w4_status: form.w4_status,
        pay_type: form.pay_type,
        pay_rate: form.pay_rate,
        pay_period: form.pay_period,
      })
      .eq('id', employee.id)
    if (error) {
      setSaveMsg('Error saving. Try again.')
    } else {
      setSaveMsg('Saved.')
      setTimeout(() => setSaveMsg(''), 2000)
      onUpdated(form)
    }
    setSaving(false)
  }

  return (
    <div className="emp-panel">
      <div className="emp-panel-header">
        <div>
          <div className="emp-panel-name">{employee.name}</div>
          <div className="emp-panel-role">{employee.role}</div>
          <a href={`/employees/${employee.id}`} style={{ fontSize: '12px', color: '#185fa5', marginTop: '2px', display: 'inline-block' }}>View full profile →</a>
        </div>
        <button className="emp-panel-close" onClick={onClose}>×</button>
      </div>

      <div className="emp-panel-actions">
        <button className="action-card-sm" onClick={() => onStartAction('onboarding')}>
          <span>→</span> Welcome pack
        </button>
        <button className="action-card-sm" onClick={() => onStartAction('checkin')}>
          <span>✓</span> Check-in
        </button>
        <button className="action-card-sm" onClick={() => onStartAction('offboarding')}>
          <span>←</span> Offboarding
        </button>
      </div>

      <ComplianceChecklist
        employeeId={employee.id}
        i9Status={form.i9_status || 'pending'}
        w4Status={form.w4_status || 'pending'}
        welcomePackSent={welcomePackSent}
        documentsSigned={documentsSigned}
        onUpdate={(field, value) => {
          setForm(prev => ({ ...prev, [field]: value }))
          onUpdated({ ...form, [field]: value })
        }}
      />

      <div className="emp-panel-section">Profile</div>

      <div className="row2">
        <div className="field">
          <label>Name</label>
          <input value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div className="field">
          <label>Role</label>
          <input value={form.role} onChange={e => set('role', e.target.value)} />
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Start date</label>
          <input type="date" value={form.start} onChange={e => set('start', e.target.value)} />
        </div>
        <div className="field">
          <label>Type</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}>
            <option>Full-time</option>
            <option>Part-time</option>
            <option>Seasonal</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Status</label>
        <select value={form.status || 'active'} onChange={e => set('status', e.target.value)}>
          <option value="active">Active</option>
          <option value="on_leave">On leave</option>
          <option value="terminated">Terminated</option>
        </select>
      </div>

      <div className="emp-panel-section">Contact</div>

      <div className="row2">
        <div className="field">
          <label>Phone</label>
          <input value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email || ''} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" />
        </div>
      </div>
      <div className="field">
        <label>Address</label>
        <input value={form.address || ''} onChange={e => set('address', e.target.value)} placeholder="123 Main St, City, State" />
      </div>
      <div className="field">
        <label>Emergency contact</label>
        <input value={form.emergency_contact || ''} onChange={e => set('emergency_contact', e.target.value)} placeholder="Jane Doe — (555) 987-6543" />
      </div>

      <div className="emp-panel-section">Payroll</div>

      <div className="row2">
        <div className="field">
          <label>Pay type</label>
          <select value={form.pay_type || 'hourly'} onChange={e => set('pay_type', e.target.value)}>
            <option value="hourly">Hourly</option>
            <option value="salary">Salary</option>
          </select>
        </div>
        <div className="field">
          <label>{form.pay_type === 'salary' ? 'Annual salary ($)' : 'Hourly rate ($)'}</label>
          <input type="number" value={form.pay_rate ?? ''} onChange={e => set('pay_rate', e.target.value)} placeholder="0.00" step="0.01" />
        </div>
      </div>
      <div className="field">
        <label>Pay period</label>
        <select value={form.pay_period || 'biweekly'} onChange={e => set('pay_period', e.target.value)}>
          <option value="weekly">Weekly</option>
          <option value="biweekly">Biweekly</option>
          <option value="semi-monthly">Semi-monthly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      <div className="emp-panel-section">HR Info</div>

      <div className="row2">
        <div className="field">
          <label>SSN (last 4)</label>
          <input value={form.ssn_last4 || ''} onChange={e => set('ssn_last4', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" maxLength={4} />
        </div>
        <div className="field">
          <label>Date of birth</label>
          <input type="date" value={form.date_of_birth || ''} onChange={e => set('date_of_birth', e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem', alignItems: 'center' }}>
        <button className="btn auth-btn-primary" onClick={save} disabled={saving} style={{ width: 'auto' }}>
          {saving ? 'Saving...' : 'Save changes'}
        </button>
        <button className="delete-btn" style={{ fontSize: '13px', opacity: 1, color: '#c0392b' }} onClick={() => onDelete(employee.id)}>
          Remove employee
        </button>
        {saveMsg && <div className="done-msg">{saveMsg}</div>}
      </div>
    </div>
  )
}
