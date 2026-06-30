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
  pay_type: string
  pay_rate: number | null
  pay_period: string
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        window.location.href = '/login'
      } else {
        setUserId(data.session.user.id)
        setUserEmail(data.session.user.email || '')
        loadData(data.session.user.id)
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
    const { error } = await supabase.from('employees').delete().eq('id', id)
    if (!error) {
      setEmployees(prev => prev.filter(e => e.id !== id))
      if (selectedEmp?.id === id) setSelectedEmp(null)
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
      userEmail={userEmail}
      onSelectEmp={setSelectedEmp}
      onAddEmployee={addEmployee}
      onUpdateEmployee={updateEmployee}
      onDeleteEmployee={deleteEmployee}
      onStartAction={startAction}
      onLogout={logout}
    />
  )
}
