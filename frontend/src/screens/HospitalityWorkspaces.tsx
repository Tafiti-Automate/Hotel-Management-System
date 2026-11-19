import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { createBackendRecord, errorMessage, readBackendPayload, readBackendRecords, runBackendAction } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const val = (x: unknown) => String(x ?? '').trim()
const today = () => new Date().toISOString().slice(0, 10)
const generateRef = (prefix: string) => prefix + '-' + crypto.randomUUID().slice(0, 12).toUpperCase()

function Notice({ message, kind = 'error' }: { message: string; kind?: 'error' | 'success' | 'info' }) {
  if (!message) return null
  return <div className={`hs-notice hs-notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{message}</div>
}
function PageHeader({ eyebrow, title, subtitle, refresh, busy }: { eyebrow: string; title: string; subtitle: string; refresh: () => void; busy: boolean }) {
  return <header className="hs-heading">
    <div><span className="hs-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
    <button type="button" className="hs-button" disabled={busy} onClick={refresh}><Icon name="refresh" size={16}/> Refresh</button>
  </header>
}
function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="hs-metric"><span>{label}</span><strong>{value}</strong></div>
}

export function ReceptionWorkspace() {
  const app = useApp()
  const canCreate = app.user.permissions.includes('hospitality.add_reservation')
  const [rooms, setRooms] = useState<Row[]>([])
  const [reservations, setReservations] = useState<Row[]>([])
  const [available, setAvailable] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [arrival, setArrival] = useState(today())
  const [departure, setDeparture] = useState('')
  const [guest, setGuest] = useState('')
  const [guests, setGuests] = useState<Row[]>([])
  const [newGuestName, setNewGuestName] = useState('')
  const [newGuestPhone, setNewGuestPhone] = useState('')
  const [reference, setReference] = useState('')
  const [room, setRoom] = useState('')
  const [notes, setNotes] = useState('')
  const [availabilityReady, setAvailabilityReady] = useState(false)
  const propertyId = app.user.branchId
  const canCheckIn = ['receptionist', 'front office manager'].includes(app.user.role.toLowerCase()) && app.user.permissions.includes('hospitality.change_reservation')
  const changeBookingStatus = async (id: string, action: 'check-in' | 'cancel') => {
    const message = action === 'check-in'
      ? 'Confirm guest identity and room readiness before checking in this reservation?'
      : 'Cancel this reservation? This will release the room allocation.'
    if (!window.confirm(message)) return
    setSaving(true); setError(''); setSuccess('')
    try {
      await runBackendAction('hospitality-reservations', id, action)
      setSuccess(action === 'check-in' ? 'Guest checked in; room marked occupied.' : 'Reservation cancelled.')
      await load()
    } catch (e) { setError(errorMessage(e)) }
    finally { setSaving(false) }
  }

  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const [roomRows, bookingRows, guestRows] = await Promise.all([
        readBackendRecords('hospitality-rooms'), readBackendRecords('hospitality-reservations'), readBackendRecords('hospitality-guests'),
      ])
      setRooms(roomRows); setReservations(bookingRows); setGuests(guestRows)
    } catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const registerGuest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!newGuestName.trim() || !canCreate) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const created = await createBackendRecord('hospitality-guests/register', {name: newGuestName.trim(), phone: newGuestPhone.trim()})
      setGuest(val(created.id)); setNewGuestName(''); setNewGuestPhone('')
      setSuccess('Guest registered to your property. Verify identity before accepting a reservation.')
      await load()
    } catch (e) { setError(errorMessage(e)) }
    finally { setSaving(false) }
  }
  const checkAvailability = useCallback(async () => {
    if (!arrival || !departure || departure <= arrival) { setError('Departure must be after arrival.'); return }
    setBusy(true); setError(''); setAvailabilityReady(false); setRoom('')
    try {
      const result = await readBackendPayload('hospitality-reservations/availability?arrival=' + encodeURIComponent(arrival) + '&departure=' + encodeURIComponent(departure)) as unknown as Row[]
      setAvailable(result); setAvailabilityReady(true)
    } catch (e) { setAvailable([]); setError(errorMessage(e)) }
    finally { setBusy(false) }
  }, [arrival, departure])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canCreate || !propertyId) return
    if (!guest.trim() || !room || !availabilityReady || !reference.trim()) {
      setError('Choose an available room, a registered guest and a booking reference.')
      return
    }
    setSaving(true); setError(''); setSuccess('')
    try {
      await createBackendRecord('hospitality-reservations', {
        branch: propertyId, room, customer: guest.trim(), reference: reference.trim(),
        arrival_date: arrival, departure_date: departure, notes,
      })
      setSuccess('Reservation saved. This does not check in the guest or create a folio.')
      setReference(''); setGuest(''); setRoom(''); setNotes(''); setAvailabilityReady(false); setAvailable([])
      await load()
    } catch (e) { setError(errorMessage(e)); setAvailabilityReady(false) }
    finally { setSaving(false) }
  }
  return <div className="hs-workspace">
    <PageHeader eyebrow="Property management · Reception" title="Reservations Desk"
      subtitle="Review property rooms, check date availability and create controlled reservations." refresh={() => void load()} busy={busy || saving}/>
    <Notice message={error}/><Notice message={success} kind="success"/>
    <div className="hs-stats"><Metric label="Rooms in property" value={rooms.length}/><Metric label="Active reservations" value={reservations.filter(r => r.status === 'reserved' || r.status === 'checked_in').length}/><Metric label="Available for selected dates" value={availabilityReady ? available.length : '—'}/></div>
    <div className="hs-columns">
      <section className="hs-panel">
        <div className="hs-panel-head"><h2>Check room availability</h2><span>Property-scoped</span></div>
        <div className="hs-panel-body">
          <div className="hs-fields">
            <label>Arrival date<input type="date" value={arrival} onChange={e => {setArrival(e.target.value);setAvailabilityReady(false);setRoom('')}}/></label>
            <label>Departure date<input type="date" min={arrival} value={departure} onChange={e => {setDeparture(e.target.value);setAvailabilityReady(false);setRoom('')}}/></label>
          </div>
          <button className="hs-button hs-button-primary" type="button" disabled={busy || saving || !arrival || !departure || departure <= arrival} onClick={() => void checkAvailability()}><Icon name="search" size={16}/> Check availability</button>
          {availabilityReady && <div className="hs-available"><strong>{available.length} available room{available.length === 1 ? '' : 's'}</strong>
            {available.length ? <div className="hs-room-chips">{available.map(r => <span key={val(r.id)}>Room {val(r.number)}</span>)}</div> : <p>No eligible rooms found for these dates.</p>}</div>}
        </div>
        <div className="hs-panel-head hs-panel-divider"><h2>Register guest</h2></div>
        <form className="hs-panel-body hs-booking-form" onSubmit={e => void registerGuest(e)}>
          <label>Guest name<input required maxLength={200} disabled={!canCreate || saving} value={newGuestName} onChange={e => setNewGuestName(e.target.value)} placeholder="Full guest name"/></label>
          <label>Contact number<input maxLength={30} disabled={!canCreate || saving} value={newGuestPhone} onChange={e => setNewGuestPhone(e.target.value)} placeholder="Optional telephone"/></label>
          <button className="hs-button" type="submit" disabled={!canCreate || saving || !newGuestName.trim()}>Register guest</button>
        </form>
        <div className="hs-panel-head hs-panel-divider"><h2>New reservation</h2></div>
        <form className="hs-panel-body hs-booking-form" onSubmit={e => void submit(e)}>
          <label>Booking reference<input value={reference} required disabled={!canCreate || saving} onChange={e => setReference(e.target.value)} placeholder="RES-2026-001" maxLength={60}/></label>
          <label>Property guest<select value={guest} required disabled={!canCreate || saving} onChange={e => setGuest(e.target.value)}><option value="">Select registered guest</option>{guests.map(g => <option value={val(g.id)} key={val(g.id)}>{val(g.name)}{g.phone ? ` · ${val(g.phone)}` : ""}</option>)}</select></label>
          <label>Available room<select value={room} required disabled={!canCreate || !availabilityReady || saving} onChange={e => setRoom(e.target.value)}><option value="">Select a verified available room</option>{available.map(r => <option key={val(r.id)} value={val(r.id)}>Room {val(r.number)}</option>)}</select></label>
          <label>Booking notes<textarea rows={2} value={notes} disabled={!canCreate || saving} onChange={e => setNotes(e.target.value)} placeholder="Optional reservation notes"/></label>
          <Notice message="Guest registration is now available. Check-in, identity verification and guest folios remain separate controlled workflows." kind="info"/>
          <button className="hs-button hs-button-primary" disabled={!canCreate || !propertyId || !availabilityReady || !room || !guest.trim() || !reference.trim() || saving} type="submit">{saving ? 'Saving…' : 'Save reservation'}</button>
          {!canCreate && <Notice message="Your role has read-only access to this register." kind="info"/>}
        </form>
      </section>
      <section className="hs-panel">
        <div className="hs-panel-head"><h2>Reservation register</h2><span>{reservations.length} records</span></div>
        <div className="hs-table-wrap"><table className="hs-table"><thead><tr><th>Reference</th><th>Room</th><th>Arrival</th><th>Departure</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{reservations.map(r => <tr key={val(r.id)}><td><strong>{val(r.reference)}</strong></td><td>{rooms.find(roomRow => val(roomRow.id) === val(r.room))?.number || 'Unassigned'}</td><td>{val(r.arrival_date)}</td><td>{val(r.departure_date)}</td><td><span className="hs-pill">{val(r.status).replaceAll('_',' ')}</span></td><td>{canCheckIn && r.status === 'reserved' && <div className="hs-inline-actions"><button className="hs-button" disabled={saving} onClick={() => void changeBookingStatus(val(r.id), 'check-in')}>Check in</button><button className="hs-button" disabled={saving} onClick={() => void changeBookingStatus(val(r.id), 'cancel')}>Cancel</button></div>}</td></tr>)}</tbody>
        </table>{!busy && !reservations.length && <div className="hs-empty">No reservations found for your assigned property.</div>}</div>
        <Notice message="Check-in and cancellation are controlled. Checkout and room-charge posting remain disabled until folio settlement is available." kind="info"/>
      </section>
    </div>
  </div>
}

export function BarPosWorkspace() {
  const app = useApp()
  const canCreate = app.user.permissions.includes('hospitality.add_poscheck')
  const [outlets, setOutlets] = useState<Row[]>([])
  const [checks, setChecks] = useState<Row[]>([])
  const [outlet, setOutlet] = useState('')
  const [tableRef, setTableRef] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [selectedCheck, setSelectedCheck] = useState('')
  const [menu, setMenu] = useState<Row[]>([])
  const [orderLines, setOrderLines] = useState<Row[]>([])
  const [selectedRecipe, setSelectedRecipe] = useState('')
  const [orderQuantity, setOrderQuantity] = useState('1')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const propertyId = app.user.branchId
  const canAddLine = app.user.permissions.includes('hospitality.add_posorderline')
  const canVoidLine = app.user.role.toLowerCase() === 'bar supervisor' && app.user.permissions.includes('hospitality.change_posorderline')
  const load = useCallback(async () => {
    setBusy(true); setError('')
    try {
      const [outletRows, checkRows] = await Promise.all([
        readBackendPayload('hospitality-pos-checks/outlets') as unknown as Promise<Row[]>,
        readBackendRecords('hospitality-pos-checks'),
      ])
      setOutlets(outletRows); setChecks(checkRows)
      setOutlet(current => outletRows.some(r => val(r.id) === current) ? current : val(outletRows[0]?.id))
    } catch (e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canCreate || !propertyId || !outlet) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const check = await createBackendRecord('hospitality-pos-checks', {
        branch: propertyId, outlet, table_reference: tableRef, reference: reference.trim() || generateRef('POS'), notes,
      })
      setSuccess('Check ' + val(check.reference) + ' opened. No payment or inventory movement has been posted.')
      setReference(''); setTableRef(''); setNotes('')
      await load()
    } catch (e) { setError(errorMessage(e)) }
    finally { setSaving(false) }
  }
  useEffect(() => {
    if (!outlet) {setMenu([]);setSelectedRecipe('');return}
    let active = true
    void (async () => {
      try {
        const rows = await readBackendPayload('hospitality-pos-checks/menu?outlet=' + encodeURIComponent(outlet)) as unknown as Row[]
        if(active) setMenu(rows)
      } catch(e) {if(active) {setMenu([]);setError(errorMessage(e))}}
    })()
    return () => {active=false}
  },[outlet])
  useEffect(() => {
    if (!selectedCheck) {setOrderLines([]); return}
    let active=true
    void (async()=>{try {
      const rows = await readBackendPayload('hospitality-pos-checks/' + encodeURIComponent(selectedCheck) + '/lines') as unknown as Row[]
      if(active) setOrderLines(rows)
    }catch(e){if(active) setError(errorMessage(e))}})()
    return ()=>{active=false}
  },[selectedCheck])
  const addOrderLine = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canAddLine || !selectedCheck || !selectedRecipe) return
    setSaving(true);setError('');setSuccess('')
    try {
      const row = await runBackendAction('hospitality-pos-checks', selectedCheck, 'add-line', {
        recipe:selectedRecipe, quantity:orderQuantity, client_reference:generateRef('LINE'),
      })
      setSuccess(val(row.item_name_snapshot) + ' added as a draft line. No payment or stock deduction was posted.')
      setOrderQuantity('1')
      const rows = await readBackendPayload('hospitality-pos-checks/' + encodeURIComponent(selectedCheck) + '/lines') as unknown as Row[]
      setOrderLines(rows)
    }catch(e){setError(errorMessage(e))}
    finally {setSaving(false)}
  }
  const voidLine = async (lineId: string) => {
    if (!selectedCheck || !canVoidLine) return
    const reason = window.prompt('Enter the reason for voiding this draft item (at least 8 characters):')
    if (reason === null) return
    if (reason.trim().length < 8) {setError('Provide a reason of at least 8 characters.');return}
    setSaving(true);setError('');setSuccess('')
    try {
      await runBackendAction('hospitality-pos-checks', selectedCheck, 'void-line', {line:lineId, reason:reason.trim()})
      setSuccess('Draft item voided with supervisor audit record.')
      setOrderLines(await readBackendPayload('hospitality-pos-checks/' + encodeURIComponent(selectedCheck) + '/lines') as unknown as Row[])
    }catch(e){setError(errorMessage(e))}
    finally{setSaving(false)}
  }
  const selectedChecks = checks.filter(r => !outlet || val(r.outlet) === outlet)
  return <div className="hs-workspace">
    <PageHeader eyebrow="Food & beverage · Bar POS" title="Bar & Restaurant Checks"
      subtitle="Manage open-check records for outlets assigned to your employee account." refresh={() => void load()} busy={busy || saving}/>
    <Notice message={error}/><Notice message={success} kind="success"/>
    <div className="hs-stats"><Metric label="Assigned outlets" value={outlets.length}/><Metric label="Open checks" value={selectedChecks.filter(r => r.status === 'open').length}/><Metric label="Recorded checks" value={selectedChecks.length}/></div>
    <div className="hs-columns">
      <section className="hs-panel">
        <div className="hs-panel-head"><h2>Outlet and new check</h2><span>Assignment required</span></div>
        <form className="hs-panel-body hs-booking-form" onSubmit={e => void submit(e)}>
          <label>Assigned outlet<select value={outlet} disabled={busy || saving || !outlets.length} onChange={e => setOutlet(e.target.value)}><option value="">Choose an outlet</option>{outlets.map(r => <option key={val(r.id)} value={val(r.id)}>{val(r.name)}</option>)}</select></label>
          <label>Check reference (optional)<input value={reference} maxLength={60} disabled={!canCreate || saving} onChange={e => setReference(e.target.value)} placeholder="Generated when empty"/></label>
          <label>Bar tab / table number<input value={tableRef} maxLength={30} disabled={!canCreate || saving} onChange={e => setTableRef(e.target.value)} placeholder="Walk-in / Table 5"/></label>
          <label>Internal notes<textarea value={notes} rows={2} disabled={!canCreate || saving} onChange={e => setNotes(e.target.value)}/></label>
          <button className="hs-button hs-button-primary" disabled={!canCreate || !outlet || !propertyId || busy || saving} type="submit"><Icon name="add" size={16}/>{saving ? 'Opening…' : 'Open POS check'}</button>
          {!canCreate && <Notice message="This role can view assigned checks but cannot open new ones." kind="info"/>}
          {!outlets.length && !busy && <Notice message="No assigned outlets. Ask the system administrator to assign your employee to a bar or restaurant outlet." kind="info"/>}
        </form>
      </section>
      <section className="hs-panel">
        <div className="hs-panel-head"><h2>Check register</h2><span>{selectedChecks.length} checks</span></div>
        <div className="hs-table-wrap"><table className="hs-table"><thead><tr><th>Reference</th><th>Outlet</th><th>Tab / table</th><th>Status</th></tr></thead>
          <tbody>{selectedChecks.map(r => <tr key={val(r.id)} className={selectedCheck===val(r.id) ? "hs-selected" : ""}><td><button type="button" className="hs-link" onClick={() => setSelectedCheck(val(r.id))}>{val(r.reference)}</button></td><td>{outlets.find(o => val(o.id) === val(r.outlet))?.name || '—'}</td><td>{val(r.table_reference) || 'Walk-in'}</td><td><span className="hs-pill">{val(r.status)}</span></td></tr>)}</tbody></table>{!busy && !selectedChecks.length && <div className="hs-empty">No checks for the selected outlet.</div>}</div>
        <div className="hs-panel-head hs-panel-divider"><h2>Draft order lines</h2><span>Not yet a posted sale</span></div>
        <div className="hs-panel-body">
          <label>Active POS check<select value={selectedCheck} onChange={e => setSelectedCheck(e.target.value)}><option value="">Select an open check</option>{selectedChecks.filter(row=>row.status==='open').map(row=><option value={val(row.id)} key={val(row.id)}>{val(row.reference)}</option>)}</select></label>
          <form className="hs-order-form" onSubmit={e => void addOrderLine(e)}>
            <label>Published menu item<select value={selectedRecipe} onChange={e=>setSelectedRecipe(e.target.value)} disabled={!canAddLine || !selectedCheck}><option value="">Choose product</option>{menu.map(row=><option key={val(row.id)} value={val(row.id)}>{val(row.name)} · {val(row.price)}</option>)}</select></label>
            <label>Quantity<input type="number" step="0.0001" min="0.0001" value={orderQuantity} onChange={e=>setOrderQuantity(e.target.value)} disabled={!canAddLine || !selectedCheck}/></label>
            <button className="hs-button hs-button-primary" disabled={!canAddLine || !selectedCheck || !selectedRecipe || saving || Number(orderQuantity)<=0} type="submit">{saving?'Adding…':'Add draft order item'}</button>
          </form>
          <div className="hs-table-wrap"><table className="hs-table"><thead><tr><th>Menu item</th><th>Qty</th><th>Unit price</th><th>Line total</th><th>Status</th></tr></thead><tbody>{orderLines.map(line=><tr key={val(line.id)}><td>{val(line.item_name_snapshot)}</td><td>{val(line.quantity)}</td><td>{val(line.unit_price_snapshot)}</td><td>{val(line.line_total)}</td><td>{line.voided_at ? <span className="hs-pill">Voided — {val(line.void_reason)}</span> : canVoidLine ? <button className="hs-button" disabled={saving} type="button" onClick={() => void voidLine(val(line.id))}>Void</button> : <span className="hs-pill">Draft</span>}</td></tr>)}</tbody></table></div>
          <strong className="hs-order-total">Draft total: {orderLines.filter(row=>!row.voided_at).reduce((sum,row)=>sum+Number(row.line_total||0),0).toLocaleString('en-UG',{maximumFractionDigits:2})}</strong>
        </div>
        <Notice message="Draft ordering is enabled. Tenders, receipts, room charges, settlement and inventory depletion remain disabled until financial controls are implemented." kind="info"/>
      </section>
    </div>
  </div>
}
