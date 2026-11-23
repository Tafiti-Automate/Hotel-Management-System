import { useCallback, useEffect, useMemo, useState } from 'react'
import { readBackendRecords, errorMessage } from '../lib/api'
import { useApp } from '../state/AppContext'
import type { Row } from '../lib/data'

const value = (input: unknown) => String(input ?? '').trim()
const normal = (input: unknown) => value(input).toLowerCase()
const display = (input: unknown) => value(input).replaceAll('_', ' ') || '—'
const today = () => new Date().toLocaleDateString('en-CA')
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
const pending: Record<string, string> = {
  'front-office-departures': 'Guest check-out is blocked until folio posting, payment settlement and balance validation are provided by the backend.',
  'front-office-assignments': 'Room moves and assignments require a controlled, conflict-checked PMS endpoint. Review allocations here; make new bookings at the Reservations Desk.',
  'front-office-housekeeping': 'Housekeeping status is read-only here. Room cleaning, inspection and out-of-order transitions require audited backend actions.',
  'front-office-folios': 'Folio opening is available from Reservations Desk after check-in. Posting charges, payments, refunds and settlements is not enabled.',
  'front-office-cashier': 'Cashier opening, tender posting and shift reconciliation require backend transaction and approval services. No financial results are inferred.',
  'front-office-night-audit': 'Night audit closing is not enabled. The review below displays live reservation exceptions only, not a certified end-of-day audit.',
  'front-office-config': 'Room and room-type master settings are managed in Room Management. Additional controls require dedicated configuration APIs and permissions.',
}
type Dataset = 'rooms' | 'reservations' | 'guests' | 'folios'
const sources: { key: Dataset; endpoint: string; permission: string }[] = [
  { key: 'rooms', endpoint: 'hospitality-rooms', permission: 'hospitality.view_room' },
  { key: 'reservations', endpoint: 'hospitality-reservations', permission: 'hospitality.view_reservation' },
  { key: 'guests', endpoint: 'hospitality-guests', permission: 'hospitality.view_guest' },
  { key: 'folios', endpoint: 'hospitality-folios', permission: 'hospitality.view_guestfolio' },
]
const reserved = (r: Row) => normal(r.status) === 'reserved'
const checkedIn = (r: Row) => ['checked_in','checked in'].includes(normal(r.status))
const inactive = (r: Row) => r.is_active === false
const roomNumber = (r: Row) => value(r.number)
const keyOf = (r: Row) => value(r.id)
const cellDate = (r: Row, field: string) => value(r[field]).slice(0, 10)

export default function FrontOfficeWorkspace({ section }: { section: string }) {
  const app = useApp()
  const [records, setRecords] = useState<Record<Dataset, Row[]>>({ rooms: [], reservations: [], guests: [], folios: [] })
  const [failures, setFailures] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [date, setDate] = useState(today())
  const property = value(app.user.branchId)
  const permissions = app.user.permissions
  const load = useCallback(async () => {
    setLoading(true)
    const allowed = sources.filter(s => permissions.includes(s.permission))
    const results = await Promise.allSettled(allowed.map(s => readBackendRecords(s.endpoint)))
    const next: Record<Dataset, Row[]> = { rooms: [], reservations: [], guests: [], folios: [] }
    const errors: string[] = []
    results.forEach((result, i) => {
      const source = allowed[i]
      if (result.status === 'fulfilled') next[source.key] = result.value.filter(r => value(r.branch) === property)
      else errors.push(source.key + ': ' + errorMessage(result.reason))
    })
    setRecords(next); setFailures(errors); setLoading(false)
  }, [property, permissions.join('|')])
  useEffect(() => { void load() }, [load])

  const roomsById = useMemo(() => new Map(records.rooms.map(r => [keyOf(r), r])), [records.rooms])
  const guestsById = useMemo(() => new Map(records.guests.map(r => [keyOf(r), r])), [records.guests])
  const roomLabel = (r: Row) => roomNumber(roomsById.get(value(r.room)) || {} as Row) || 'Unassigned'
  const reservationRows = records.reservations
  const filtered = useMemo(() => {
    if (section === 'front-office-arrivals') return reservationRows.filter(r => reserved(r) && cellDate(r,'arrival_date') === date)
    if (section === 'front-office-inhouse') return reservationRows.filter(checkedIn)
    if (section === 'front-office-departures') return reservationRows.filter(r => checkedIn(r) && cellDate(r,'departure_date') <= date)
    if (section === 'front-office-assignments') return reservationRows.filter(r => reserved(r) || checkedIn(r))
    if (section === 'front-office-night-audit') return reservationRows.filter(r => checkedIn(r) && cellDate(r,'departure_date') < date)
    return reservationRows
  }, [date, reservationRows, section])
  const guestRows = records.guests
  const roomRows = records.rooms
  const folioRows = records.folios
  const q = normal(search)
  const matches = (values: unknown[]) => !q || values.some(v => normal(v).includes(q))
  const useRooms = section === 'front-office-housekeeping' || section === 'front-office-config'
  const useGuests = section === 'front-office-guests'
  const useFolios = section === 'front-office-folios'
  const useExceptions = section === 'front-office-night-audit'
  const showsDate = ['front-office-arrivals','front-office-departures','front-office-night-audit'].includes(section)
  const title = titles[section] || 'Front Office'
  const go = (route: string, label: string) => app.navTo(route, label)
  const present = (dataset: Dataset) => permissions.includes(sources.find(s => s.key === dataset)!.permission)
  return <div className="hs-workspace">
    <header className="hs-heading">
      <div><span className="hs-eyebrow">Property management · Front office</span><h1>{title}</h1>
        <p>Property-scoped PMS register and operational review. Financial posting stays under controlled backend authorization.</p></div>
      <button type="button" className="hs-button" disabled={loading} onClick={() => void load()}>Refresh</button>
    </header>
    {!property && <div className="hs-notice hs-notice-error" role="alert">No hotel property is assigned to this user. Contact the system administrator.</div>}
    {failures.map(e => <div className="hs-notice hs-notice-error" role="alert" key={e}>{e}</div>)}
    {pending[section] && <div className="hs-notice hs-notice-info" role="status">{pending[section]}</div>}
    {loading && <div className="hs-notice hs-notice-info" role="status">Loading live front office records…</div>}
    <div className="hs-stats">
      <div className="hs-metric"><span>Registered rooms</span><strong>{present('rooms') ? roomRows.length : 'Restricted'}</strong></div>
      <div className="hs-metric"><span>Occupied reservations</span><strong>{present('reservations') ? reservationRows.filter(checkedIn).length : 'Restricted'}</strong></div>
      <div className="hs-metric"><span>Expected arrivals</span><strong>{present('reservations') ? reservationRows.filter(r => reserved(r) && cellDate(r,'arrival_date') === date).length : 'Restricted'}</strong></div>
      <div className="hs-metric"><span>Expected departures</span><strong>{present('reservations') ? reservationRows.filter(r => checkedIn(r) && cellDate(r,'departure_date') === date).length : 'Restricted'}</strong></div>
    </div>
    <div className="hs-inline-actions" style={{margin:'12px 0'}}>
      <button className="hs-button hs-button-primary" type="button" onClick={() => go('front-desk-reservations', 'Reservation Management')}>Open Reservations Desk</button>
      <button className="hs-button" type="button" onClick={() => go('front-desk-rooms', 'Room Management')}>Manage Rooms</button>
    </div>
    <section className="hs-panel">
      <div className="hs-panel-head"><h2>{useRooms ? 'Room status register' : useGuests ? 'Guest register' : useFolios ? 'Opened folios' : useExceptions ? 'Past-due in-house reservations' : 'Reservations and allocations'}</h2><span>Live records only</span></div>
      <div className="hs-panel-body" style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        <label>Search<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search this register" /></label>
        {showsDate && <label>Business date<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}
      </div>
      <div className="hs-table-wrap"><table className="hs-table">
        {useRooms ? <>
          <thead><tr><th>Room</th><th>Floor</th><th>Occupancy</th><th>Housekeeping</th><th>Active</th></tr></thead>
          <tbody>{roomRows.filter(r => matches([r.number,r.floor,r.status,r.housekeeping_status])).map(r => <tr key={keyOf(r)}><td><strong>{roomNumber(r)}</strong></td><td>{display(r.floor)}</td><td>{display(r.status)}</td><td>{display(r.housekeeping_status)}</td><td>{inactive(r)?'No':'Yes'}</td></tr>)}</tbody>
        </> : useGuests ? <>
          <thead><tr><th>Guest name</th><th>Phone</th><th>Email</th></tr></thead>
          <tbody>{guestRows.filter(r => matches([r.name,r.phone,r.email])).map(r => <tr key={keyOf(r)}><td>{display(r.name)}</td><td>{display(r.phone)}</td><td>{display(r.email)}</td></tr>)}</tbody>
        </> : useFolios ? <>
          <thead><tr><th>Reservation</th><th>Room</th><th>Status</th><th>Posting</th></tr></thead>
          <tbody>{folioRows.filter(r => matches([r.reservation,r.status])).map(r => {
            const reservation=reservationRows.find(item=>keyOf(item)===value(r.reservation))
            return <tr key={keyOf(r)}><td>{reservation ? display(reservation.reference) : 'Restricted'}</td><td>{reservation ? roomLabel(reservation) : '—'}</td><td>{display(r.status)}</td><td>Backend settlement pending</td></tr>
          })}</tbody>
        </> : <>
          <thead><tr><th>Reference</th><th>Guest</th><th>Room</th><th>Arrival</th><th>Departure</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{filtered.filter(r => matches([r.reference, r.status, roomLabel(r),guestsById.get(value(r.customer))?.name])).map(r => <tr key={keyOf(r)}>
            <td><strong>{display(r.reference)}</strong></td><td>{display(guestsById.get(value(r.customer))?.name)}</td><td>{roomLabel(r)}</td>
            <td>{display(r.arrival_date)}</td><td>{display(r.departure_date)}</td><td>{display(r.status)}</td>
            <td>{reserved(r) ? <button type="button" className="hs-button" onClick={() => go('front-desk-reservations','Reservation Management')}>Review check-in</button> : '—'}</td>
          </tr>)}</tbody>
        </>}
      </table>
      {!loading && ((useRooms && !roomRows.length) || (useGuests && !guestRows.length) || (useFolios && !folioRows.length) || (!useRooms && !useGuests && !useFolios && !filtered.length)) && <div className="hs-empty">No matching records are available for this property and selection.</div>}
      </div>
    </section>
    {section === 'front-office-dashboard' && <div className="hs-notice hs-notice-info">Occupancy rate and revenue require a validated room-night denominator and posted folio ledger; these figures are intentionally not estimated from incomplete data.</div>}
    {section === 'front-office-reports' && <div className="hs-notice hs-notice-info">This operational register is not a finalized revenue or statutory report. Financial reports will be enabled once posting and night-audit services are implemented.</div>}
    {section === 'front-office-config' && <div className="hs-notice hs-notice-info">Configuration changes use Room Management and the authorized administrator setup pages. No unverified configuration mutations are available here.</div>}
  </div>
}
