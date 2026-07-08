'use client'

import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import Dashboard from './components/Dashboard'
import ActionScreen from './components/ActionScreen'

export type Employee = {
  id: number
  name: string
  role: string
  start: string
  type: string
  phone: string
  email: string
  address: string
  emergency_contact: string
  ssn_last4: string
  date_of_birth: string
  status: string
  i9_status: string
  w4_status: string
  direct_deposit_status: string
  pay_type: string
  pay_rate: number | null
  pay_period: string
  // 'admin' | 'manager' | 'employee' — owners are identified by business_profiles row
  access_role: string
}

export type ActionType = 'onboarding' | 'checkin' | 'offboarding' | null

export default function Home() {
  const [employees, setEmployees] = useState<Employee[]>([])
  const [selectedEmp, setSelectedEmp] = useState<Employee | null>(null)
  const [action, setAction] = useState<ActionType>(null)
  const [docsGenerated, setDocsGenerated] = useState(0)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState('')
  // 'owner' if they have a business_profiles row; otherwise their employee access_role
  const [viewerRole, setViewerRole] = useState<'owner' | 'admin' | 'manager' | 'employee'>('owner')
  const [viewerPerms, setViewerPerms] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) { window.location.href = '/login'; return }
      const session = data.session

      // Check if this user is an owner (has business_profiles row)
      const { data: biz } = await supabase
        .from('business_profiles')
        .select('user_id')
        .eq('user_id', session.user.id)
        .single()

      if (biz) {
        // Owner — use their own user_id for all queries
        setUserId(session.user.id)
        setUserEmail(session.user.email || '')
        setViewerRole('owner')
        loadData(session.user.id)
      } else {
        // Not an owner — look up employee record by email to get owner's user_id
        const { data: emp } = await supabase
          .from('employees')
          .select('user_id, access_role, email, permissions')
          .eq('email', session.user.email ?? '')
          .single()

        if (!emp) { window.location.href = '/login'; return }

        const accessRole = emp.access_role as 'admin' | 'manager' | 'employee'
        if (accessRole === 'employee') { window.location.href = '/portal'; return }

        // Admin or manager — load the owner's business data
        setUserId(emp.user_id)
        setUserEmail(session.user.email || '')
        setViewerRole(accessRole)
        if (emp.permissions) setViewerPerms(emp.permissions)
        loadData(emp.user_id)
      }
    })
  }, [])

  async function loadData(uid: string) {
    setLoading(true)
    const [empRes, docRes] = await Promise.all([
      supabase.from('employees').select('*').eq('user_id', uid).order('created_at', { ascending: true }),
      supabase.from('documents').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    ])
    if (empRes.data) setEmployees(empRes.data)
    if (docRes.count !== null) setDocsGenerated(docRes.count)
    setLoading(false)
  }

  async function addEmployee(emp: Omit<Employee, 'id'>) {
    if (!userId) return
    const { data, error } = await supabase
      .from('employees')
      .insert([{ ...emp, user_id: userId }])
      .select()
      .single()
    if (!error && data) {
      setEmployees(prev => [...prev, data])
    }
  }

  function updateEmployee(emp: Employee) {
    setEmployees(prev => prev.map(e => e.id === emp.id ? emp : e))
    setSelectedEmp(emp)
  }

  async function deleteEmployee(id: number) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const res = await fetch(`/api/employees/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (res.ok) {
      setEmployees(prev => prev.filter(e => e.id !== id))
      if (selectedEmp?.id === id) setSelectedEmp(null)
    } else {
      const data = await res.json()
      alert(data.error || 'Failed to remove employee')
    }
  }

  async function logout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  function startAction(type: ActionType) {
    if (!selectedEmp) return
    setAction(type)
  }

  function goHome() {
    setAction(null)
    setSelectedEmp(null)
  }

  function onDocDone() {
    setDocsGenerated(n => n + 1)
  }

  if (action && selectedEmp) {
    return (
      <ActionScreen
        employee={selectedEmp}
        action={action}
        onBack={goHome}
        onDocDone={onDocDone}
        userId={userId!}
      />
    )
  }

  return (
    <Dashboard
      employees={employees}
      selectedEmp={selectedEmp}
      docsGenerated={docsGenerated}
      loading={loading}
      viewerRole={viewerRole}
      viewerPerms={viewerPerms}
      onSelectEmp={setSelectedEmp}
      onAddEmployee={addEmployee}
      onUpdateEmployee={updateEmployee}
      onDeleteEmployee={deleteEmployee}
      onStartAction={startAction}
    />
  )
}
