import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { errorMessage, fetchHotels, saveHotel, type HotelInput, type HotelRecord } from '../lib/api'
import { useApp } from '../state/AppContext'
import { extractPaletteFromImage, type BrandPalette } from '../lib/brandTheme'

const emptyHotel: HotelInput = {
  name: '',
  legal_name: '',
  business_type: 'single',
  registration_number: '',
  tax_identification_number: '',
  email: '',
  phone: '',
  alternate_phone: '',
  website: '',
  address: '',
  city: '',
  country: 'Uganda',
  currency: 'UGX',
  timezone: 'Africa/Kampala',
  brand_primary_color: '#1D4ED8',
  brand_secondary_color: '#0F766E',
  brand_accent_color: '#D97706',
  use_logo_theme: true,
  is_active: true,
}

const cardStyle: CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 16,
  boxShadow: 'var(--shadow)',
}

function cleanLogoUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.pathname.startsWith('/media/')) return `${parsed.pathname}${parsed.search}`
  } catch {
    /* use the original value */
  }
  return value
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'HT'
}

function display(value: string | null | undefined): string {
  return value?.trim() || 'Not provided'
}

function InfoItem({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        <Icon name={icon} size={16} color="var(--text-faint)" />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 650, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{value}</div>
      </div>
    </div>
  )
}

function HotelCard({ hotel, canEdit, onEdit }: { hotel: HotelRecord; canEdit: boolean; onEdit: () => void }) {
  const logo = cleanLogoUrl(hotel.logo)
  return (
    <article style={{ ...cardStyle, overflow: 'hidden' }}>
      <div style={{ padding: 22, display: 'flex', alignItems: 'flex-start', gap: 16, borderBottom: '1px solid var(--border)', background: 'linear-gradient(135deg,var(--accent-soft),transparent 62%)' }}>
        <div style={{ width: 68, height: 68, borderRadius: 16, background: logo ? '#fff' : 'var(--accent)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flex: 'none', color: '#fff', fontSize: 20, fontWeight: 800 }}>
          {logo ? <img src={logo} alt={`${hotel.name} logo`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : initials(hotel.name)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 19, color: 'var(--text)', letterSpacing: '-.02em' }}>{hotel.name}</h2>
            <span style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 20, color: hotel.is_active ? 'var(--good)' : 'var(--text-muted)', background: hotel.is_active ? 'var(--good-soft)' : 'var(--surface-2)', fontWeight: 800 }}>{hotel.is_active ? 'Active' : 'Inactive'}</span>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 5 }}>{display(hotel.legal_name)}</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 11, color: 'var(--text-muted)', fontSize: 11.5, fontWeight: 650 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="domain" size={15} />{hotel.business_type === 'group' ? 'Hotel Group' : 'Single Hotel'}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="apartment" size={15} />{hotel.branch_count} {hotel.branch_count === 1 ? 'branch' : 'branches'}</span>
          </div>
        </div>
        {canEdit && (
          <button onClick={onEdit} className="hover-edit" style={{ height: 36, padding: '0 12px', border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 10, cursor: 'pointer', color: 'var(--text-muted)', font: 'inherit', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="edit" size={16} />Edit
          </button>
        )}
      </div>

      <div style={{ padding: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: '20px 26px' }}>
        <InfoItem label="Registration number" value={display(hotel.registration_number)} icon="badge" />
        <InfoItem label="TIN" value={display(hotel.tax_identification_number)} icon="receipt_long" />
        <InfoItem label="Email" value={display(hotel.email)} icon="mail" />
        <InfoItem label="Phone" value={display(hotel.phone)} icon="call" />
        <InfoItem label="Alternate phone" value={display(hotel.alternate_phone)} icon="phone_in_talk" />
        <InfoItem label="Website" value={display(hotel.website)} icon="language" />
        <InfoItem label="Address" value={display(hotel.address)} icon="location_on" />
        <InfoItem label="City / Country" value={[hotel.city, hotel.country].filter(Boolean).join(', ') || 'Not provided'} icon="public" />
        <InfoItem label="Currency" value={display(hotel.currency)} icon="payments" />
        <InfoItem label="Timezone" value={display(hotel.timezone)} icon="schedule" />
      </div>
    </article>
  )
}

function Field({ label, children, required = false }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 750, marginBottom: 7 }}>{label}{required ? ' *' : ''}</span>
      {children}
    </label>
  )
}

const controlStyle: CSSProperties = {
  width: '100%',
  minHeight: 42,
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  borderRadius: 10,
  padding: '0 12px',
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
}

function HotelForm({ hotel, onClose, onSaved }: { hotel: HotelRecord | null; onClose: () => void; onSaved: (hotel: HotelRecord) => void }) {
  const [values, setValues] = useState<HotelInput>(() => hotel ? {
    name: hotel.name,
    legal_name: hotel.legal_name,
    business_type: hotel.business_type,
    registration_number: hotel.registration_number,
    tax_identification_number: hotel.tax_identification_number,
    email: hotel.email,
    phone: hotel.phone,
    alternate_phone: hotel.alternate_phone,
    website: hotel.website,
    address: hotel.address,
    city: hotel.city,
    country: hotel.country,
    currency: hotel.currency,
    timezone: hotel.timezone,
    is_active: hotel.is_active,
  } : emptyHotel)
  const [logo, setLogo] = useState<File | null>(null)
  const [extractingTheme, setExtractingTheme] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = useMemo(() => logo ? URL.createObjectURL(logo) : cleanLogoUrl(hotel?.logo || null), [hotel?.logo, logo])

  useEffect(() => () => {
    if (logo && preview?.startsWith('blob:')) URL.revokeObjectURL(preview)
  }, [logo, preview])

  const setValue = <K extends keyof HotelInput>(key: K, value: HotelInput[K]) => setValues((current) => ({ ...current, [key]: value }))

  const applyExtractedPalette = async (source: File | string) => {
    setExtractingTheme(true)
    setError(null)
    try {
      const palette: BrandPalette = await extractPaletteFromImage(source)
      setValues((current) => ({
        ...current,
        brand_primary_color: palette.primary,
        brand_secondary_color: palette.secondary,
        brand_accent_color: palette.accent,
        use_logo_theme: true,
      }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setExtractingTheme(false)
    }
  }

  const onLogoSelected = (file: File | null) => {
    setLogo(file)
    if (file) void applyExtractedPalette(file)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!values.name.trim()) {
      setError('Hotel name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveHotel(hotel?.id || null, { ...values, name: values.name.trim() }, logo)
      try {
        localStorage.setItem('hms_hotel_brand_theme', JSON.stringify({ primary: saved.brand_primary_color, secondary: saved.brand_secondary_color, accent: saved.brand_accent_color, enabled: saved.use_logo_theme }))
        window.dispatchEvent(new CustomEvent('hotel-theme-updated', { detail: saved }))
      } catch { /* ignore storage failures */ }
      onSaved(saved)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div onClick={saving ? undefined : onClose} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,17,33,.46)' }} />
      <form onSubmit={submit} style={{ position: 'fixed', inset: '0 0 0 auto', zIndex: 71, width: 620, maxWidth: '96vw', background: 'var(--surface)', boxShadow: '-12px 0 40px rgba(16,17,33,.2)', display: 'flex', flexDirection: 'column', animation: 'slideIn .22s ease' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{hotel ? 'Edit Hotel Profile' : 'Register Hotel'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 3 }}>Fields marked * are required.</div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="hover-surface2" style={{ width: 32, height: 32, border: 'none', background: 'var(--surface-2)', borderRadius: 9, cursor: 'pointer', color: 'var(--text-muted)' }}><Icon name="close" size={19} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>
          {error && <div style={{ padding: '11px 13px', borderRadius: 10, background: 'var(--bad-soft)', color: 'var(--bad)', fontSize: 12.5, fontWeight: 650, marginBottom: 18 }}>{error}</div>}

          <section style={{ marginBottom: 24 }}>
            <div style={sectionTitleStyle}>Identity</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
              <Field label="Hotel name" required><input autoFocus value={values.name} onChange={(e) => setValue('name', e.target.value)} style={controlStyle} /></Field>
              <Field label="Legal name"><input value={values.legal_name} onChange={(e) => setValue('legal_name', e.target.value)} style={controlStyle} /></Field>
              <Field label="Business type">
                <select value={values.business_type} onChange={(e) => setValue('business_type', e.target.value as HotelInput['business_type'])} style={controlStyle}>
                  <option value="single">Single Hotel</option>
                  <option value="group">Hotel Group / Multiple Branches</option>
                </select>
              </Field>
              <Field label="Registration number"><input value={values.registration_number} onChange={(e) => setValue('registration_number', e.target.value)} style={controlStyle} /></Field>
              <Field label="Tax identification number (TIN)"><input value={values.tax_identification_number} onChange={(e) => setValue('tax_identification_number', e.target.value)} style={controlStyle} /></Field>
              <Field label="Hotel logo">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => onLogoSelected(e.target.files?.[0] || null)} style={{ ...controlStyle, padding: 8 }} />
              </Field>
            </div>
            {preview && <img src={preview} alt="Hotel logo preview" style={{ marginTop: 12, width: 72, height: 72, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 12, background: '#fff' }} />}
          </section>

          <section style={{ marginBottom: 24 }}>
            <div style={sectionTitleStyle}>Brand theme</div>
            <div style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface-2)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, fontWeight: 700, color: 'var(--text)', marginBottom: 14 }}>
                <input type="checkbox" checked={values.use_logo_theme} onChange={(e) => setValue('use_logo_theme', e.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--accent)' }} />
                Use colors generated from the hotel logo
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                {([
                  ['Primary', 'brand_primary_color'],
                  ['Secondary', 'brand_secondary_color'],
                  ['Accent', 'brand_accent_color'],
                ] as const).map(([label,key]) => <Field key={key} label={label}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="color" value={values[key]} onChange={(e) => setValue(key, e.target.value.toUpperCase())} style={{ width: 44, height: 38, border: '1px solid var(--border)', borderRadius: 8, padding: 3, background: 'var(--surface)' }} />
                    <input value={values[key]} onChange={(e) => setValue(key, e.target.value.toUpperCase())} maxLength={7} style={{ ...controlStyle, minWidth: 0 }} />
                  </div>
                </Field>)}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                {[values.brand_primary_color, values.brand_secondary_color, values.brand_accent_color].map((color, index) => <span key={index} style={{ width: 46, height: 28, borderRadius: 7, background: color, border: '1px solid rgba(0,0,0,.12)' }} />)}
                {preview && <button type="button" disabled={extractingTheme} onClick={() => void applyExtractedPalette(preview)} className="hover-surface2" style={{ marginLeft: 'auto', height: 36, padding: '0 12px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 12, fontWeight: 700, cursor: extractingTheme ? 'wait' : 'pointer' }}>{extractingTheme ? 'Generating…' : 'Regenerate from logo'}</button>}
              </div>
              <div style={{ marginTop: 11, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>The system creates accessible light and dark palettes. You can adjust the generated colors before saving.</div>
            </div>
          </section>

          <section style={{ marginBottom: 24 }}>
            <div style={sectionTitleStyle}>Contact details</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
              <Field label="Email"><input type="email" value={values.email} onChange={(e) => setValue('email', e.target.value)} style={controlStyle} /></Field>
              <Field label="Website"><input type="url" placeholder="https://example.com" value={values.website} onChange={(e) => setValue('website', e.target.value)} style={controlStyle} /></Field>
              <Field label="Phone"><input value={values.phone} onChange={(e) => setValue('phone', e.target.value)} style={controlStyle} /></Field>
              <Field label="Alternate phone"><input value={values.alternate_phone} onChange={(e) => setValue('alternate_phone', e.target.value)} style={controlStyle} /></Field>
            </div>
          </section>

          <section style={{ marginBottom: 24 }}>
            <div style={sectionTitleStyle}>Location</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
              <Field label="Address"><textarea value={values.address} onChange={(e) => setValue('address', e.target.value)} style={{ ...controlStyle, height: 86, padding: 11, resize: 'vertical' }} /></Field>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <Field label="City"><input value={values.city} onChange={(e) => setValue('city', e.target.value)} style={controlStyle} /></Field>
                <Field label="Country"><input value={values.country} onChange={(e) => setValue('country', e.target.value)} style={controlStyle} /></Field>
              </div>
            </div>
          </section>

          <section>
            <div style={sectionTitleStyle}>Regional settings</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
              <Field label="Currency"><input value={values.currency} onChange={(e) => setValue('currency', e.target.value.toUpperCase())} style={controlStyle} /></Field>
              <Field label="Timezone"><input value={values.timezone} onChange={(e) => setValue('timezone', e.target.value)} style={controlStyle} /></Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, cursor: 'pointer', fontSize: 12.5, color: 'var(--text)', fontWeight: 700 }}>
              <input type="checkbox" checked={values.is_active} onChange={(e) => setValue('is_active', e.target.checked)} style={{ width: 17, height: 17, accentColor: 'var(--accent)' }} />
              Hotel profile is active
            </label>
          </section>
        </div>

        <div style={{ padding: '16px 22px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} disabled={saving} className="hover-surface2" style={{ height: 42, padding: '0 18px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', borderRadius: 11, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700 }}>Cancel</button>
          <button type="submit" disabled={saving} className="hover-accent" style={{ height: 42, minWidth: 126, padding: '0 18px', border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 11, cursor: saving ? 'wait' : 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700 }}>{saving ? 'Saving…' : hotel ? 'Save changes' : 'Register hotel'}</button>
        </div>
      </form>
    </>
  )
}

const sectionTitleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 850,
  color: 'var(--text)',
  textTransform: 'uppercase',
  letterSpacing: '.07em',
  paddingBottom: 9,
  marginBottom: 14,
  borderBottom: '1px solid var(--border)',
}

export default function HotelProfile() {
  const app = useApp()
  const [hotels, setHotels] = useState<HotelRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<HotelRecord | 'new' | null>(null)
  const canEdit = app.user.isStaff

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setHotels(await fetchHotels())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const saved = (hotel: HotelRecord) => {
    setHotels((current) => {
      const found = current.some((item) => item.id === hotel.id)
      return found ? current.map((item) => item.id === hotel.id ? hotel : item) : [hotel, ...current]
    })
    setEditing(null)
    app.showToast(hotels.some((item) => item.id === hotel.id) ? 'Hotel profile updated' : 'Hotel registered')
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="domain" size={23} color="var(--accent)" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 23, fontWeight: 800, color: 'var(--text)', letterSpacing: '-.02em' }}>Hotel Profile</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>Company identity, contacts and operating defaults</p>
          </div>
        </div>
        {canEdit && hotels.length > 0 && (
          <button onClick={() => setEditing('new')} className="hover-accent" style={{ display: 'flex', alignItems: 'center', gap: 7, height: 38, padding: '0 15px', border: 'none', cursor: 'pointer', background: 'var(--accent)', color: '#fff', borderRadius: 10, font: 'inherit', fontSize: 13, fontWeight: 700 }}>
            <Icon name="add" size={18} />Register hotel
          </button>
        )}
      </div>

      {loading && <div style={{ ...cardStyle, padding: 42, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading hotel profile…</div>}

      {!loading && error && (
        <div style={{ ...cardStyle, padding: 28, textAlign: 'center' }}>
          <Icon name="cloud_off" size={30} color="var(--bad)" />
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginTop: 9 }}>Could not load hotel profiles</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: '6px 0 14px' }}>{error}</div>
          <button onClick={() => void load()} className="hover-surface2" style={{ height: 36, padding: '0 14px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', borderRadius: 9, cursor: 'pointer', font: 'inherit', fontWeight: 700 }}>Try again</button>
        </div>
      )}

      {!loading && !error && hotels.length === 0 && (
        <div style={{ ...cardStyle, padding: '54px 28px', textAlign: 'center' }}>
          <div style={{ width: 58, height: 58, borderRadius: 17, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}><Icon name="hotel" size={30} color="var(--accent)" /></div>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>No hotel has been registered</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', margin: '7px auto 17px', maxWidth: 430, lineHeight: 1.55 }}>Capture the parent hotel or hotel group before setting up its branches and properties.</div>
          {canEdit ? (
            <button onClick={() => setEditing('new')} className="hover-accent" style={{ height: 40, padding: '0 17px', border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 10, cursor: 'pointer', font: 'inherit', fontSize: 13, fontWeight: 700 }}><Icon name="add" size={17} style={{ verticalAlign: 'middle', marginRight: 6 }} />Register hotel</button>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>An administrator must register the hotel.</div>
          )}
        </div>
      )}

      {!loading && !error && hotels.length > 0 && (
        <div style={{ display: 'grid', gap: 16 }}>
          {hotels.map((hotel) => <HotelCard key={hotel.id} hotel={hotel} canEdit={canEdit} onEdit={() => setEditing(hotel)} />)}
        </div>
      )}

      {editing && <HotelForm hotel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={saved} />}
    </div>
  )
}
