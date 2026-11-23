import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { createBackendRecord, errorMessage, readBackendRecords, updateBackendRecord } from '../lib/api'
import type { Row } from '../lib/data'
import { useApp } from '../state/AppContext'

const str = (value: unknown): string => String(value ?? '').trim()
const statusName = (value: unknown): string =>
  str(value).split('_').map(word => word ? word[0].toUpperCase() + word.slice(1) : '').join(' ')

export default function RoomManagementWorkspace() {
  const app = useApp()
  const role = app.user.role.trim().toLowerCase()
  const isAdmin = app.user.isSuperuser || role === 'system administrator'
  const canCreateRoom = isAdmin || app.user.permissions.includes('hospitality.add_room')
  const canEditRoom = isAdmin || app.user.permissions.includes('hospitality.change_room')
  const canCreateType = isAdmin || app.user.permissions.includes('hospitality.add_roomtype')
  const canEditType = isAdmin || app.user.permissions.includes('hospitality.change_roomtype')

  const branches = useMemo(() => isAdmin
    ? app.data.branches
    : app.data.branches.filter(branch => str(branch.id) === app.user.branchId),
  [app.data.branches, app.user.branchId, isAdmin])

  const [branch, setBranch] = useState(app.user.branchId)
  useEffect(() => {
    if (!branch || !branches.some(item => str(item.id) === branch)) {
      setBranch(str(branches[0]?.id))
    }
  }, [branch, branches])

  const [allTypes, setAllTypes] = useState<Row[]>([])
  const [allRooms, setAllRooms] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [query, setQuery] = useState('')
  const [editTypeId, setEditTypeId] = useState('')
  const [typeCode, setTypeCode] = useState('')
  const [typeName, setTypeName] = useState('')
  const [typeCapacity, setTypeCapacity] = useState('2')
  const [typeActive, setTypeActive] = useState(true)
  const [editRoomId, setEditRoomId] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [roomFloor, setRoomFloor] = useState('')
  const [roomTypeId, setRoomTypeId] = useState('')
  const [roomActive, setRoomActive] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [types, rooms] = await Promise.all([
        readBackendRecords('hospitality-room-types'),
        readBackendRecords('hospitality-rooms'),
      ])
      setAllTypes(types)
      setAllRooms(rooms)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const roomTypes = useMemo(() =>
    allTypes.filter(item => str(item.branch) === branch),
  [allTypes, branch])
  const propertyRooms = useMemo(() =>
    allRooms.filter(item => str(item.branch) === branch),
  [allRooms, branch])
  const displayedRooms = useMemo(() => {
    const term = query.trim().toLowerCase()
    return propertyRooms.filter(item => !term || [item.number, item.floor,
      allTypes.find(type => str(type.id) === str(item.room_type))?.name,
    ].some(value => str(value).toLowerCase().includes(term)))
  }, [propertyRooms, allTypes, query])
  const selectedBranchName = branches.find(item => str(item.id) === branch)?.name || 'Choose property'
  const typeNameById = (id: unknown): string =>
    str(roomTypes.find(type => str(type.id) === str(id))?.name) || 'Room type unavailable'
  const resetType = () => {
    setEditTypeId(''); setTypeCode(''); setTypeName(''); setTypeCapacity('2'); setTypeActive(true)
  }
  const resetRoom = () => {
    setEditRoomId(''); setRoomNumber(''); setRoomFloor(''); setRoomTypeId(''); setRoomActive(true)
  }
  const pickBranch = (id: string) => {
    setBranch(id); resetType(); resetRoom(); setQuery(''); setError(''); setSuccess('')
  }
  const editType = (item: Row) => {
    setEditTypeId(str(item.id)); setTypeCode(str(item.code)); setTypeName(str(item.name))
    setTypeCapacity(str(item.capacity)); setTypeActive(item.is_active !== false)
    setError(''); setSuccess('')
  }
  const editRoom = (item: Row) => {
    setEditRoomId(str(item.id)); setRoomNumber(str(item.number)); setRoomFloor(str(item.floor))
    setRoomTypeId(str(item.room_type)); setRoomActive(item.is_active !== false)
    setError(''); setSuccess('')
  }

  const saveType = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!branch || !typeCode.trim() || !typeName.trim() || !Number.isInteger(Number(typeCapacity)) ||
        Number(typeCapacity) < 1 || Number(typeCapacity) > 255) {
      setError('Choose a property, a room-type code, name and capacity between 1 and 255.')
      return
    }
    if (editTypeId && !canEditType || !editTypeId && !canCreateType) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const values = {
        branch, code: typeCode.trim().toUpperCase(), name: typeName.trim(),
        capacity: Number(typeCapacity), is_active: typeActive,
      }
      if (editTypeId) await updateBackendRecord('hospitality-room-types', editTypeId, values)
      else await createBackendRecord('hospitality-room-types', values)
      setSuccess(editTypeId ? 'Room type updated.' : 'Room type created. You can now register rooms of this type.')
      resetType()
      await load()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setSaving(false) }
  }
  const saveRoom = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!branch || !roomNumber.trim() || !roomTypeId) {
      setError('Choose a property, a valid room type and a room number.')
      return
    }
    if (!roomTypes.some(item => str(item.id) === roomTypeId)) {
      setError('The selected room type does not belong to this property.')
      return
    }
    if (editRoomId && !canEditRoom || !editRoomId && !canCreateRoom) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const values = {
        branch, room_type: roomTypeId, number: roomNumber.trim(),
        floor: roomFloor.trim(), is_active: roomActive,
      }
      if (editRoomId) await updateBackendRecord('hospitality-rooms', editRoomId, values)
      else await createBackendRecord('hospitality-rooms', values)
      setSuccess(editRoomId ? 'Room details updated.' : 'Room registered. It is now available to the reservations system, subject to its operational status.')
      resetRoom()
      await load()
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setSaving(false) }
  }

  return <div className="hs-workspace rm-workspace">
    <header className="hs-heading">
      <div>
        <span className="hs-eyebrow">Property management · Accommodation setup</span>
        <h1>Room Management</h1>
        <p>Register room types and room numbers before the Front Desk can accept bookings.
          Room occupancy and housekeeping conditions remain controlled by their own workflows.</p>
      </div>
      <div className="rm-heading-actions">
        <button type="button" className="hs-button" disabled={loading || saving} onClick={() => void load()}>
          <Icon name="refresh" size={16} /> Refresh
        </button>
        {role === 'front office manager' && <button type="button" className="hs-button" onClick={() => app.navTo('front-desk-reservations', 'Reservations Desk')}>
          <Icon name="hotel" size={16} /> Reservations Desk
        </button>}
      </div>
    </header>

    <section className="hs-panel rm-property-bar">
      <label>Property
        <select value={branch} onChange={event => pickBranch(event.target.value)}
          disabled={!isAdmin || saving || branches.length < 2}>
          {!branches.length && <option value="">No assigned hotel property</option>}
          {branches.map(item => <option key={str(item.id)} value={str(item.id)}>{str(item.name)}</option>)}
        </select>
      </label>
      <p>Room types and numbers must belong to the same property. Receptionists cannot create or edit room master data.</p>
    </section>

    {loading && <div className="hs-notice hs-notice-info" role="status">Loading rooms and room types…</div>}
    {error && <div className="hs-notice hs-notice-error" role="alert">{error}</div>}
    {success && <div className="hs-notice hs-notice-success" role="status">{success}</div>}
    {!loading && !!branch && <>
      <div className="hs-stats">
        <div className="hs-metric"><span>Rooms in {str(selectedBranchName)}</span><strong>{propertyRooms.length}</strong></div>
        <div className="hs-metric"><span>Active rooms</span><strong>{propertyRooms.filter(item => item.is_active !== false).length}</strong></div>
        <div className="hs-metric"><span>Room types</span><strong>{roomTypes.length}</strong></div>
      </div>
      <div className="rm-split">
        <section className="hs-panel">
          <div className="hs-panel-head"><h2>Room types</h2><span>Step 1 · Register room categories</span></div>
          <form className="hs-panel-body rm-form" onSubmit={event => void saveType(event)}>
            <div className="rm-field-row">
              <label>Room type code<input required maxLength={20} value={typeCode} disabled={saving || !(editTypeId ? canEditType : canCreateType)}
                onChange={event => setTypeCode(event.target.value)} placeholder="STD" /></label>
              <label>Guest capacity<input required type="number" min={1} max={255} value={typeCapacity}
                disabled={saving || !(editTypeId ? canEditType : canCreateType)}
                onChange={event => setTypeCapacity(event.target.value)}/></label>
            </div>
            <label>Room type name<input required maxLength={100} value={typeName}
              disabled={saving || !(editTypeId ? canEditType : canCreateType)}
              onChange={event => setTypeName(event.target.value)} placeholder="Standard Double Room"/></label>
            <label className="rm-check"><input type="checkbox" checked={typeActive} onChange={event => setTypeActive(event.target.checked)}
              disabled={saving || !(editTypeId ? canEditType : canCreateType)}/> Active room type</label>
            <div className="rm-form-buttons">
              <button type="submit" className="hs-button hs-button-primary" disabled={saving || !(editTypeId ? canEditType : canCreateType)}>
                <Icon name={editTypeId ? 'save' : 'add'} size={15}/>{saving ? 'Saving…' : editTypeId ? 'Save room type' : 'Create room type'}
              </button>
              {editTypeId && <button type="button" className="hs-button" onClick={resetType}>Cancel edit</button>}
            </div>
          </form>
          <div className="hs-table-wrap"><table className="hs-table rm-table">
            <thead><tr><th>Code</th><th>Room type</th><th>Capacity</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{roomTypes.map(item => <tr key={str(item.id)}>
              <td>{str(item.code)}</td><td><strong>{str(item.name)}</strong></td><td>{str(item.capacity)}</td>
              <td>{item.is_active === false ? 'Inactive' : 'Active'}</td>
              <td>{canEditType && <button type="button" className="rm-link" onClick={() => editType(item)}>Edit</button>}</td>
            </tr>)}
            {!roomTypes.length && <tr><td colSpan={5} className="rm-empty">No room types registered. Add one above before creating rooms.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <section className="hs-panel">
          <div className="hs-panel-head"><h2>Rooms</h2><span>Step 2 · Register room numbers</span></div>
          <form className="hs-panel-body rm-form" onSubmit={event => void saveRoom(event)}>
            <div className="rm-field-row">
              <label>Room number<input required maxLength={20} value={roomNumber}
                disabled={saving || !(editRoomId ? canEditRoom : canCreateRoom)}
                onChange={event => setRoomNumber(event.target.value)} placeholder="101"/></label>
              <label>Floor<input maxLength={20} value={roomFloor} onChange={event => setRoomFloor(event.target.value)}
                disabled={saving || !(editRoomId ? canEditRoom : canCreateRoom)}
                placeholder="First floor"/></label>
            </div>
            <label>Room type<select required value={roomTypeId} onChange={event => setRoomTypeId(event.target.value)}
              disabled={saving || !(editRoomId ? canEditRoom : canCreateRoom)}>
              <option value="">Choose room type</option>
              {roomTypes.filter(type => type.is_active !== false || str(type.id) === roomTypeId).map(type =>
                <option key={str(type.id)} value={str(type.id)}>{str(type.code)} · {str(type.name)}</option>)}
            </select></label>
            <label className="rm-check"><input type="checkbox" checked={roomActive} onChange={event => setRoomActive(event.target.checked)}
              disabled={saving || !(editRoomId ? canEditRoom : canCreateRoom)}/> Active room</label>
            <div className="rm-form-buttons">
              <button type="submit" className="hs-button hs-button-primary" disabled={saving || !roomTypes.length || !(editRoomId ? canEditRoom : canCreateRoom)}>
                <Icon name={editRoomId ? 'save' : 'add'} size={15}/>{saving ? 'Saving…' : editRoomId ? 'Save room' : 'Create room'}
              </button>
              {editRoomId && <button type="button" className="hs-button" onClick={resetRoom}>Cancel edit</button>}
            </div>
          </form>
          <div className="rm-search"><label>Search rooms
            <input type="search" placeholder="Room number, floor or type" value={query} onChange={event => setQuery(event.target.value)}/>
          </label></div>
          <div className="hs-table-wrap"><table className="hs-table rm-table">
            <thead><tr><th>Room</th><th>Type</th><th>Floor</th><th>Occupancy</th><th>Housekeeping</th><th>Action</th></tr></thead>
            <tbody>{displayedRooms.map(item => <tr key={str(item.id)}>
              <td><strong>{str(item.number)}</strong>{item.is_active === false && <small>Inactive</small>}</td>
              <td>{typeNameById(item.room_type)}</td><td>{str(item.floor) || '—'}</td>
              <td>{statusName(item.status)}</td><td>{statusName(item.housekeeping_status)}</td>
              <td>{canEditRoom && <button type="button" className="rm-link" onClick={() => editRoom(item)}>Edit</button>}</td>
            </tr>)}
            {!displayedRooms.length && <tr><td colSpan={6} className="rm-empty">
              {propertyRooms.length ? 'No rooms match this search.' : 'No rooms registered. Create a room type, then add room numbers above.'}
            </td></tr>}
            </tbody>
          </table></div>
        </section>
      </div>
      <div className="hs-notice hs-notice-info">Room configuration does not change occupied, reserved, housekeeping or folio records. Changes to rooms with reservation history are restricted.</div>
    </>}
    {!loading && !branch && <div className="hs-notice hs-notice-info">Create an active branch in Property Setup and assign it to your hotel before registering rooms.</div>}
  </div>
}
