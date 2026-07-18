// Mirrors the employee time-off flow backed by /api/employee/time-off
// (GET list / POST new request) and /api/employee/pto-balance.
import { useCallback, useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, TextInput, StyleSheet, Modal, ActivityIndicator, Platform } from 'react-native'
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { api, ApiError } from '../../src/lib/api'
import type { TimeOffRequest } from '../../src/types'

type Balance = { total: number; used: number; remaining: number } | null
type PickerTarget = 'start' | 'end' | null

const TYPES = ['vacation', 'sick', 'unpaid', 'other']

function statusColor(status: string) {
  if (status === 'approved') return '#4ade80'
  if (status === 'denied') return '#f87171'
  return '#fbbf24'
}

function toISODateString(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatDisplayDate(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TimeOff() {
  const [requests, setRequests] = useState<TimeOffRequest[]>([])
  const [balance, setBalance] = useState<Balance>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [startDate, setStartDate] = useState<Date | null>(null)
  const [endDate, setEndDate] = useState<Date | null>(null)
  const [activePicker, setActivePicker] = useState<PickerTarget>(null)
  const [type, setType] = useState(TYPES[0])
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [{ requests }, { balance }] = await Promise.all([
        api.get<{ requests: TimeOffRequest[] }>('/api/employee/time-off'),
        api.get<{ balance: Balance }>('/api/employee/pto-balance'),
      ])
      setRequests(requests)
      setBalance(balance)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submit() {
    if (!startDate || !endDate) { setError('Start and end date are required.'); return }
    setSubmitting(true)
    setError('')
    try {
      await api.post('/api/employee/time-off', {
        startDate: toISODateString(startDate),
        endDate: toISODateString(endDate),
        type,
        reason,
      })
      setShowForm(false)
      setStartDate(null); setEndDate(null); setReason(''); setType(TYPES[0])
      load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  function closeForm() {
    setShowForm(false)
    setActivePicker(null)
  }

  function onPickDate(target: Exclude<PickerTarget, null>) {
    return (event: DateTimePickerEvent, selected?: Date) => {
      if (Platform.OS === 'android') setActivePicker(null)
      if (event.type === 'dismissed') return
      if (!selected) return
      if (target === 'start') setStartDate(selected)
      else setEndDate(selected)
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#4ade80" /></View>
  }

  return (
    <View style={styles.wrap}>
      {balance && (
        <View style={styles.balanceRow}>
          <View style={styles.balanceCard}><Text style={styles.balanceNum}>{balance.remaining}</Text><Text style={styles.balanceLabel}>Remaining</Text></View>
          <View style={styles.balanceCard}><Text style={styles.balanceNum}>{balance.used}</Text><Text style={styles.balanceLabel}>Used</Text></View>
          <View style={styles.balanceCard}><Text style={styles.balanceNum}>{balance.total}</Text><Text style={styles.balanceLabel}>Total</Text></View>
        </View>
      )}

      <Pressable style={styles.requestButton} onPress={() => setShowForm(true)}>
        <Text style={styles.requestButtonText}>Request time off</Text>
      </Pressable>

      <FlatList
        data={requests}
        keyExtractor={r => String(r.id)}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={styles.empty}>No time-off requests yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.cardDate}>{item.start_date} → {item.end_date}</Text>
              <Text style={[styles.status, { color: statusColor(item.status) }]}>{item.status}</Text>
            </View>
            <Text style={styles.cardType}>{item.type}</Text>
            {item.reason ? <Text style={styles.cardReason}>{item.reason}</Text> : null}
          </View>
        )}
      />

      <Modal visible={showForm} animationType="slide" transparent onRequestClose={closeForm}>
        <View style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.cardTitle}>Request time off</Text>
            <Pressable style={styles.input} onPress={() => setActivePicker(activePicker === 'start' ? null : 'start')}>
              <Text style={startDate ? styles.dateText : styles.datePlaceholder}>
                {startDate ? formatDisplayDate(startDate) : 'Start date'}
              </Text>
            </Pressable>
            {activePicker === 'start' && (
              <DateTimePicker
                value={startDate ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onPickDate('start')}
              />
            )}
            {Platform.OS === 'ios' && activePicker === 'start' && (
              <Pressable style={styles.doneButton} onPress={() => setActivePicker(null)}>
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
            )}

            <Pressable style={styles.input} onPress={() => setActivePicker(activePicker === 'end' ? null : 'end')}>
              <Text style={endDate ? styles.dateText : styles.datePlaceholder}>
                {endDate ? formatDisplayDate(endDate) : 'End date'}
              </Text>
            </Pressable>
            {activePicker === 'end' && (
              <DateTimePicker
                value={endDate ?? startDate ?? new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onPickDate('end')}
              />
            )}
            {Platform.OS === 'ios' && activePicker === 'end' && (
              <Pressable style={styles.doneButton} onPress={() => setActivePicker(null)}>
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
            )}
            <View style={styles.typeRow}>
              {TYPES.map(t => (
                <Pressable key={t} style={[styles.typeChip, type === t && styles.typeChipActive]} onPress={() => setType(t)}>
                  <Text style={[styles.typeChipText, type === t && { color: '#0b0f14' }]}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput style={[styles.input, { height: 70 }]} placeholder="Reason (optional)" placeholderTextColor="#64748b" value={reason} onChangeText={setReason} multiline />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <Pressable style={[styles.modalButton, { backgroundColor: 'rgba(255,255,255,0.06)' }]} onPress={closeForm}>
                <Text style={{ color: '#f1f5f9' }}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalButton, { backgroundColor: '#4ade80' }, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
                <Text style={{ color: '#0b0f14', fontWeight: '700' }}>{submitting ? 'Submitting…' : 'Submit'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0b0f14' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0f14' },
  balanceRow: { flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 0 },
  balanceCard: { flex: 1, backgroundColor: '#11161d', borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  balanceNum: { color: '#f1f5f9', fontSize: 20, fontWeight: '800' },
  balanceLabel: { color: '#64748b', fontSize: 11, marginTop: 2 },
  requestButton: { margin: 16, marginBottom: 0, backgroundColor: 'rgba(74,222,128,0.1)', borderWidth: 1, borderColor: 'rgba(74,222,128,0.3)', borderRadius: 12, padding: 12, alignItems: 'center' },
  requestButtonText: { color: '#4ade80', fontWeight: '700', fontSize: 14 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 40, fontSize: 13 },
  card: { backgroundColor: '#11161d', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  cardDate: { color: '#f1f5f9', fontWeight: '700', fontSize: 13 },
  cardType: { color: '#94a3b8', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  cardReason: { color: '#64748b', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  status: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#11161d', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 10 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#f1f5f9', marginBottom: 4 },
  input: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, color: '#f1f5f9', fontSize: 14 },
  dateText: { color: '#f1f5f9', fontSize: 14 },
  datePlaceholder: { color: '#64748b', fontSize: 14 },
  doneButton: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 14 },
  doneButtonText: { color: '#4ade80', fontWeight: '700', fontSize: 13 },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typeChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  typeChipActive: { backgroundColor: '#4ade80', borderColor: '#4ade80' },
  typeChipText: { color: '#94a3b8', fontSize: 12, textTransform: 'capitalize' },
  error: { color: '#f87171', fontSize: 12 },
  modalButton: { flex: 1, padding: 12, borderRadius: 10, alignItems: 'center' },
})
