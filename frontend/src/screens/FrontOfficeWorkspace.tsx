import OverviewAnalytics from '../components/OverviewAnalytics'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { errorMessage, readBackendRecords, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const val = (item: unknown): string => String(item ?? '').trim()
const lower = (item: unknown): string => val(item).toLowerCase()
const display = (item: unknown): string => val(item).replaceAll('_', ' ') || '—'
const day = (item: unknown): string => val(item).slice(0, 10)
const today = (): string => {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}
const isReserved = (row: Row) => lower(row.status) === 'reserved'
const isCheckedIn = (row: Row) => lower(row.status) === 'checked_in'
const isActiveBooking = (row: Row) => isReserved(row) || isCheckedIn(row)
type DataKey = 'rooms' | 'reservations' | 'guests' | 'folios'
const datasets: { key: DataKey; endpoint: string; permission: string }[] = [
  { key: 'rooms', endpoint: 'hospitality-rooms', permission: 'hospitality.view_room' },
  { key: 'reservations', endpoint: 'hospitality-reservations', permission: 'hospitality.view_reservation' },
  { key: 'guests', endpoint: 'hospitality-guests', permission: 'hospitality.view_propertyguest' },
  { key: 'folios', endpoint: 'hospitality-folios', permission: 'hospitality.view_guestfolio' },
]
const empty = (): Record<DataKey, Row[]> => ({ rooms: [], reservations: [], guests: [], folios: [] })
const titles: Record<string, string> = {
  'front-office-dashboard': 'Front Office Dashboard',
  'front-office-arrivals': 'Arrivals & Check-in',
  'front-office-inhouse': 'In-house Guests',
  'front-office-departures': 'Departures & Check-out',
  'front-office-assignments': 'Room Assignments & Moves',
  'front-office-housekeeping': 'Housekeeping Status',
  'front-office-guests': 'Guest Profiles',
  'front-office-folios': 'Guest Folios & Billing',
  'front-office-cashier': 'Cashier & Shift Reconciliation',
  'front-office-night-audit': 'Night Audit Review',
  'front-office-reports': 'Front Office Reports',
  'front-office-config': 'Front Office Configuration',
}
const limitations: Record<string, string> = {
  'front-office-departures': 'Guest check-out is blocked until folio posting, payment settlement and balance validation are supported by Django.',
  'front-office-housekeeping': 'Room condition changes require an audit reason. The system will not change guest occupancy through this screen.',
  'front-office-assignments': 'Room moves are checked under a property lock, then recorded in the immutable audit trail. New bookings still begin at Reservations Desk.',
  'front-office-folios': 'Folio creation is available after check-in. Accommodation charges, payment postings and settlements are not yet operational.',
  'front-office-cashier': 'Cashier custody and financial reconciliation are not interchangeable. This screen does not calculate a tender variance or post receipts.',
  'front-office-night-audit': 'Night audit closing is not enabled; this is a live exception register, not a certified financial closing.',
  'front-office-config': 'Room types and room master data are managed under Room Management. Other configuration requires authorized backend settings.',
}

export default function FrontOfficeWorkspace({ section }: { section: string }) {
  const app = useApp()
  const property = val(app.user.branchId)
  const permissions = app.user.permissions
  const permissionKey = permissions.join('|')
  const [records, setRecords] = useState<Record<DataKey, Row[]>>(empty)
  const [failures, setFailures] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [businessDate, setBusinessDate] = useState(today)
  const [selectedRoom, setSelectedRoom] = useState('')
  const [condition, setCondition] = useState('')
  const [reason, setReason] = useState('')
  const [selectedReservation, setSelectedReservation] = useState('')
  const [targetRoom, setTargetRoom] = useState('')
  const [moveReason, setMoveReason] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const allowed = datasets.filter(d => permissions.includes(d.permission))
    const results = await Promise.allSettled(allowed.map(d => readBackendRecords(d.endpoint)))
    const rows = empty()
    const errors: string[] = []
    results.forEach((result, index) => {
      const source = allowed[index]
      if (result.status === 'rejected') {
        errors.push(source.key + ': ' + errorMessage(result.reason))
      } else {
        // The guest endpoint is already property-scoped and its serializer
        // intentionally has no branch field. Never filter it by a missing field.
        rows[source.key] = source.key === 'guests'
          ? result.value : result.value.filter(row => val(row.branch) === property)
      }
    })
    setRecords(rows)
    setFailures(errors)
    setLoading(false)
  }, [property, permissionKey])
  useEffect(() => { void load() }, [load])

  const roomById = useMemo(() => new Map(records.rooms.map(r => [val(r.id), r])), [records.rooms])
  const guestById = useMemo(() => new Map(records.guests.map(r => [val(r.id), r])), [records.guests])
  const roomLabel = (r: Row) => val(roomById.get(val(r.room))?.number) || 'Unassigned'
  const matches = (values: unknown[]) => !search.trim() ||
    values.some(item => lower(item).includes(search.trim().toLowerCase()))
  const reservations = records.reservations
  const filterRows = useMemo(() => {
    if (section === 'front-office-arrivals') return reservations.filter(r => isReserved(r) && day(r.arrival_date) === businessDate)
    if (section === 'front-office-inhouse') return reservations.filter(isCheckedIn)
    if (section === 'front-office-departures') return reservations.filter(r => isCheckedIn(r) && day(r.departure_date) <= businessDate)
    if (section === 'front-office-assignments') return reservations.filter(isActiveBooking)
    if (section === 'front-office-night-audit') return reservations.filter(r => isCheckedIn(r) && day(r.departure_date) < businessDate)
    return reservations
  }, [reservations, section, businessDate])
  const pendingMove = reservations.find(r => val(r.id) === selectedReservation)
  const destinationOptions = records.rooms.filter(room =>
    room.is_active !== false && lower(room.status) === 'vacant' &&
    val(room.id) !== val(pendingMove?.room) &&
    (!pendingMove || isReserved(pendingMove) || ['clean', 'inspected'].includes(lower(room.housekeeping_status))) &&
    (!pendingMove || !reservations.some(other =>
      val(other.id) !== val(pendingMove.id) && val(other.room) === val(room.id) &&
      isActiveBooking(other) && day(other.arrival_date) < day(pendingMove.departure_date) &&
      day(other.departure_date) > day(pendingMove.arrival_date)
    ))
  )
  const roomRegister = section === 'front-office-housekeeping' || section === 'front-office-config'
  const guestRegister = section === 'front-office-guests'
  const folioRegister = section === 'front-office-folios'
  const showingDate = ['front-office-arrivals','front-office-departures','front-office-night-audit'].includes(section)
  const canChangeRooms = permissions.includes('hospitality.change_room')
  const canMoveReservations = permissions.includes('hospitality.change_reservation')
  const hasDataAccess = (dataset: DataKey) => permissions.includes(datasets.find(d => d.key === dataset)!.permission)
  const go = (route: string, label: string) => app.navTo(route, label)

  const saveRoomCondition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canChangeRooms || !selectedRoom || !condition || reason.trim().length < 8 || saving) return
    if (!window.confirm('Confirm this audited room condition change?')) return
    setSaving(true); setActionError(''); setActionSuccess('')
    try {
      await runBackendAction('hospitality-rooms', selectedRoom, 'change-condition', {condition, reason: reason.trim()})
      setSelectedRoom(''); setCondition(''); setReason('')
      await load()
      setActionSuccess('Room condition changed successfully. The action was audited.')
    } catch (error) { setActionError(errorMessage(error)) }
    finally { setSaving(false) }
  }
  const saveRoomMove = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canMoveReservations || !selectedReservation || !targetRoom || moveReason.trim().length < 8 || saving) return
    if (!window.confirm('Move this guest to the selected room? An occupied source room will become dirty.')) return
    setSaving(true); setActionError(''); setActionSuccess('')
    try {
      await runBackendAction('hospitality-reservations', selectedReservation, 'move-room',
        {target_room: targetRoom, reason: moveReason.trim()})
      setSelectedReservation(''); setTargetRoom(''); setMoveReason('')
      await load()
      setActionSuccess('Guest room move completed and recorded in the audit trail.')
    } catch (error) { setActionError(errorMessage(error)) }
    finally { setSaving(false) }
  }

  return <div className="hs-workspace">
    <header className="hs-heading">
      <div><span className="hs-eyebrow">Front Office Management · Property-scoped PMS</span>
        <h1>{titles[section] || 'Front Office'}</h1>
        <p>Current hotel operational records, with backend-controlled room and reservation changes.</p></div>
      <button className="hs-button" type="button" disabled={loading || saving} onClick={() => void load()}>Refresh</button>
    </header>
    {!property && <div className="hs-notice hs-notice-error" role="alert">This account has no assigned property. Contact the administrator.</div>}
    {limitations[section] && <div className="hs-notice hs-notice-info" role="status">{limitations[section]}</div>}
    {loading && <div className="hs-notice hs-notice-info" role="status">Loading property records…</div>}
    {failures.map(error => <div key={error} className="hs-notice hs-notice-error" role="alert">{error}</div>)}
    {actionError && <div className="hs-notice hs-notice-error" role="alert">{actionError}</div>}
    {actionSuccess && <div className="hs-notice hs-notice-success" role="status">{actionSuccess}</div>}
    <div className="hs-stats">
      <div className="hs-metric"><span>Total registered rooms</span><strong>{hasDataAccess('rooms') ? records.rooms.length : 'Restricted'}</strong></div>
      <div className="hs-metric"><span>Checked-in guests</span><strong>{hasDataAccess('reservations') ? reservations.filter(isCheckedIn).length : 'Restricted'}</strong></div>
      <div className="hs-metric"><span>Arrivals on {businessDate}</span><strong>{hasDataAccess('reservations') ? reservations.filter(r => isReserved(r) && day(r.arrival_date) === businessDate).length : 'Restricted'}</strong></div>
      <div className="hs-metric"><span>Due to depart</span><strong>{hasDataAccess('reservations') ? reservations.filter(r => isCheckedIn(r) && day(r.departure_date) === businessDate).length : 'Restricted'}</strong></div>
    </div>
    {section==='front-office-dashboard'&&<OverviewAnalytics title="Reservations analytics" scope={property} ready={!loading&&!failures.length&&Boolean(property)&&hasDataAccess('reservations')} dateLabel="Scheduled arrival date" groups={[{label:'Reservations',rows:reservations.map(r=>({...r,analytics_date:r.arrival_date}))}]}/>}
    <div className="hs-inline-actions" style={{margin:'12px 0'}}>
      <button type="button" className="hs-button hs-button-primary" onClick={() => go('front-desk-reservations', 'Reservation Management')}>Reservations Desk</button>
      <button type="button" className="hs-button" onClick={() => go('front-desk-rooms', 'Room Management')}>Room Management</button>
    </div>
    <section className="hs-panel">
      <div className="hs-panel-head"><h2>{roomRegister ? 'Room condition register' : guestRegister ? 'Registered property guests' :
        folioRegister ? 'Guest folio containers' : section === 'front-office-night-audit' ? 'Overdue in-house exceptions' : 'Reservations register'}</h2>
        <span>Live property data</span></div>
      <div className="hs-panel-body" style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        <label>Search<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by number, status or guest"/></label>
        {showingDate && <label>Business date<input type="date" value={businessDate} onChange={e => setBusinessDate(e.target.value)}/></label>}
      </div>
      <div className="hs-table-wrap"><table className="hs-table">
      {roomRegister ? <>
        <thead><tr><th>Room</th><th>Floor</th><th>Occupancy</th><th>Housekeeping</th><th>Active</th><th>Action</th></tr></thead>
        <tbody>{records.rooms.filter(r => matches([r.number,r.floor,r.status,r.housekeeping_status])).map(r => <tr key={val(r.id)}>
          <td><strong>{display(r.number)}</strong></td><td>{display(r.floor)}</td><td>{display(r.status)}</td>
          <td>{display(r.housekeeping_status)}</td><td>{r.is_active === false ? 'No' : 'Yes'}</td>
          <td>{section === 'front-office-housekeeping' && canChangeRooms ?
            <button className="hs-button" type="button" disabled={saving} onClick={() => {setSelectedRoom(val(r.id));setCondition('');setReason('');setActionError('')}}>Change condition</button> : '—'}</td>
        </tr>)}</tbody>
      </> : guestRegister ? <>
        <thead><tr><th>Guest name</th><th>Telephone</th><th>Email</th></tr></thead>
        <tbody>{records.guests.filter(r => matches([r.name,r.phone,r.email])).map(r => <tr key={val(r.id)}>
          <td>{display(r.name)}</td><td>{display(r.phone)}</td><td>{display(r.email)}</td>
        </tr>)}</tbody>
      </> : folioRegister ? <>
        <thead><tr><th>Reservation</th><th>Room</th><th>Status</th><th>Balance</th></tr></thead>
        <tbody>{records.folios.filter(r => matches([r.reservation,r.status])).map(r => {
          const reservation = reservations.find(x => val(x.id) === val(r.reservation))
          return <tr key={val(r.id)}><td>{reservation ? display(reservation.reference) : 'Restricted'}</td>
            <td>{reservation ? roomLabel(reservation) : '—'}</td><td>{display(r.status)}</td>
            <td>{r.balance == null ? 'Not posted' : display(r.balance)}</td></tr>
        })}</tbody>
      </> : <>
        <thead><tr><th>Reference</th><th>Guest</th><th>Room</th><th>Arrival</th><th>Departure</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{filterRows.filter(r => matches([r.reference,r.status,roomLabel(r),guestById.get(val(r.customer))?.name])).map(r => <tr key={val(r.id)}>
          <td><strong>{display(r.reference)}</strong></td><td>{display(guestById.get(val(r.customer))?.name)}</td>
          <td>{roomLabel(r)}</td><td>{display(r.arrival_date)}</td><td>{display(r.departure_date)}</td><td>{display(r.status)}</td>
          <td>{section === 'front-office-assignments' && isActiveBooking(r) && canMoveReservations ?
            <button type="button" className="hs-button" disabled={saving} onClick={() => {setSelectedReservation(val(r.id));setTargetRoom('');setMoveReason('');setActionError('')}}>Move room</button>
            : isReserved(r) ? <button type="button" className="hs-button" onClick={() => go('front-desk-reservations', 'Reservation Management')}>Review check-in</button> : '—'}</td>
        </tr>)}</tbody>
      </>}
      </table>
      {!loading && (roomRegister && !records.rooms.length || guestRegister && !records.guests.length ||
        folioRegister && !records.folios.length || !roomRegister && !guestRegister && !folioRegister && !filterRows.length) &&
        <div className="hs-empty">No matching records for this property and selection.</div>}
      </div>
      {section === 'front-office-housekeeping' && !!selectedRoom && <form className="hs-panel-body hs-booking-form" onSubmit={e => void saveRoomCondition(e)}>
        <h3>Change condition · Room {display(roomById.get(selectedRoom)?.number)}</h3>
        <label>New condition<select required value={condition} disabled={saving} onChange={e => setCondition(e.target.value)}>
          <option value="">Choose condition</option><option value="dirty">Dirty</option><option value="clean">Clean</option>
          <option value="inspected">Inspected</option><option value="out_of_order">Out of order</option>
          <option value="return_to_service">Return to service</option></select></label>
        <label>Reason<textarea required minLength={8} maxLength={250} rows={2} value={reason}
          onChange={e => setReason(e.target.value)} placeholder="Reason (8–250 characters)" disabled={saving}/></label>
        <div className="hs-inline-actions">
          <button type="submit" className="hs-button hs-button-primary" disabled={!condition || reason.trim().length < 8 || saving}>Save room condition</button>
          <button type="button" className="hs-button" onClick={() => setSelectedRoom('')} disabled={saving}>Cancel</button>
        </div>
      </form>}
      {section === 'front-office-assignments' && !!selectedReservation && <form className="hs-panel-body hs-booking-form" onSubmit={e => void saveRoomMove(e)}>
        <h3>Move reservation · {display(pendingMove?.reference)}</h3>
        <p>Current room: {pendingMove ? roomLabel(pendingMove) : '—'}. Availability is verified again at submission.</p>
        <label>Destination room<select required value={targetRoom} disabled={saving} onChange={e => setTargetRoom(e.target.value)}>
          <option value="">Select an eligible room</option>{destinationOptions.map(r => <option key={val(r.id)} value={val(r.id)}>Room {val(r.number)} · {display(r.housekeeping_status)}</option>)}
        </select></label>
        <label>Reason<textarea required minLength={8} maxLength={250} rows={2} value={moveReason}
          onChange={e => setMoveReason(e.target.value)} placeholder="Reason (8–250 characters)" disabled={saving}/></label>
        <div className="hs-inline-actions"><button className="hs-button hs-button-primary" type="submit" disabled={!targetRoom || moveReason.trim().length < 8 || saving}>Confirm room move</button>
          <button type="button" className="hs-button" onClick={() => setSelectedReservation('')} disabled={saving}>Cancel</button></div>
      </form>}
    </section>
    {section === 'front-office-dashboard' && <div className="hs-notice hs-notice-info">Revenue and financial occupancy rates cannot be certified without a posted accommodation and payment ledger.</div>}
    {section === 'front-office-reports' && <div className="hs-notice hs-notice-info">These are live operating figures, not completed finance or statutory reports.</div>}
    {section === 'front-office-config' && <div className="hs-notice hs-notice-info">Authorized master-data changes are available from Room Management. This view does not silently alter operational settings.</div>}
  </div>
}
