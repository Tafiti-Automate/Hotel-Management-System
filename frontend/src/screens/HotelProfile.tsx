import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { errorMessage, fetchHotels, saveHotel, type HotelInput, type HotelRecord } from '../lib/api'
import { normalizeUgandaPhone } from '../lib/ugandaPhone'
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

function valuesFromHotel(hotel: HotelRecord | null): HotelInput {
  if (!hotel) return { ...emptyHotel }
  return {
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
    brand_primary_color: hotel.brand_primary_color || emptyHotel.brand_primary_color,
    brand_secondary_color: hotel.brand_secondary_color || emptyHotel.brand_secondary_color,
    brand_accent_color: hotel.brand_accent_color || emptyHotel.brand_accent_color,
    use_logo_theme: hotel.use_logo_theme ?? emptyHotel.use_logo_theme,
    is_active: hotel.is_active,
  }
}

const settingsNav = [
  { id: 'company', label: 'Company', icon: 'business_center' },
  { id: 'branding', label: 'Branding', icon: 'palette' },
  { id: 'contact', label: 'Contact', icon: 'alternate_email' },
  { id: 'location', label: 'Location', icon: 'location_on' },
  { id: 'regional', label: 'Regional', icon: 'language' },
]

function SettingsField({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="company-settings-field">
      <span className="company-settings-label">{label}{required && <b> *</b>}</span>
      {children}
      {hint && <span className="company-settings-hint">{hint}</span>}
    </label>
  )
}

function CompanySettingsForm({
  hotel,
  canEdit,
  onSaved,
}: {
  hotel: HotelRecord | null
  canEdit: boolean
  onSaved: (hotel: HotelRecord) => void
}) {
  const [values, setValues] = useState<HotelInput>(() => valuesFromHotel(hotel))
  const [logo, setLogo] = useState<File | null>(null)
  const [extractingTheme, setExtractingTheme] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setValues(valuesFromHotel(hotel))
    setLogo(null)
    setError(null)
  }, [hotel?.id])

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
    if (!canEdit || saving) return
    if (!values.name.trim()) {
      setError('Hotel name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = await saveHotel(
        hotel?.id || null,
        {
          ...values,
          name: values.name.trim(),
          phone: normalizeUgandaPhone(values.phone),
          alternate_phone: normalizeUgandaPhone(values.alternate_phone),
        },
        logo,
      )
      try {
        localStorage.setItem('hms_hotel_brand_theme', JSON.stringify({
          primary: saved.brand_primary_color,
          secondary: saved.brand_secondary_color,
          accent: saved.brand_accent_color,
          enabled: saved.use_logo_theme,
        }))
        window.dispatchEvent(new CustomEvent('hotel-theme-updated', { detail: saved }))
      } catch {
        /* ignore storage failures */
      }
      onSaved(saved)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="company-settings-form" onSubmit={submit}>
      {error && (
        <div className="company-settings-error">
          <Icon name="error" size={16} />
          <span>{error}</span>
        </div>
      )}

      <section id="company" className="company-settings-section company-settings-section-first">
        <SettingsField label="Company name" hint="Used on invoices, emails, PDF headers, and throughout the workspace" required>
          <input
            value={values.name}
            onChange={(e) => setValue('name', e.target.value)}
            disabled={!canEdit}
            placeholder="Hotel or company name"
          />
        </SettingsField>

        <SettingsField label="Legal / registered name" hint="Optional legal entity name used for official records">
          <input
            value={values.legal_name}
            onChange={(e) => setValue('legal_name', e.target.value)}
            disabled={!canEdit}
            placeholder="Registered company name"
          />
        </SettingsField>

        <div className="company-settings-field">
          <span className="company-settings-label">Company logo <em>(optional)</em></span>
          <button
            type="button"
            className="company-logo-dropzone"
            onClick={() => canEdit && fileRef.current?.click()}
            disabled={!canEdit}
          >
            <span className="company-logo-preview">
              {preview
                ? <img src={preview} alt={`${values.name || 'Company'} logo`} />
                : <span>{initials(values.name)}</span>}
            </span>
            <span className="company-logo-drop-copy">
              <span className="company-logo-upload-icon"><Icon name="upload" size={18} /></span>
              <strong>{canEdit ? 'Click to upload or drag and drop' : 'Company logo'}</strong>
              <small>PNG, JPG or WebP · Max 2MB</small>
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            disabled={!canEdit}
            onChange={(e) => onLogoSelected(e.target.files?.[0] || null)}
          />
          <span className="company-settings-hint">Displayed throughout the ERP and on supported documents.</span>
        </div>

        <div className="company-settings-grid company-settings-grid-2">
          <SettingsField label="Business type">
            <select value={values.business_type} onChange={(e) => setValue('business_type', e.target.value as HotelInput['business_type'])} disabled={!canEdit}>
              <option value="single">Single Hotel</option>
              <option value="group">Hotel Group / Multiple Branches</option>
            </select>
          </SettingsField>
          <SettingsField label="Registration number">
            <input value={values.registration_number} onChange={(e) => setValue('registration_number', e.target.value)} disabled={!canEdit} placeholder="Company registration number" />
          </SettingsField>
        </div>
      </section>

      <section id="branding" className="company-settings-section">
        <div className="company-settings-section-heading">
          <div>
            <strong>Branding</strong>
            <span>Control the visual identity used by the ERP.</span>
          </div>
          <label className="company-theme-toggle">
            <input type="checkbox" checked={values.use_logo_theme} onChange={(e) => setValue('use_logo_theme', e.target.checked)} disabled={!canEdit} />
            <span>Use logo theme</span>
          </label>
        </div>

        <div className="company-settings-field">
          <span className="company-settings-label">Brand colors <em>(optional)</em></span>
          <div className="company-brand-row">
            {([
              ['Primary', 'brand_primary_color'],
              ['Secondary', 'brand_secondary_color'],
              ['Accent', 'brand_accent_color'],
            ] as const).map(([label, key]) => (
              <label className="company-color-control" key={key} title={label}>
                <input type="color" value={values[key]} onChange={(e) => setValue(key, e.target.value.toUpperCase())} disabled={!canEdit} />
                <span style={{ background: values[key] }} />
                <small>{label}</small>
              </label>
            ))}
            {preview && canEdit && (
              <button type="button" className="company-regenerate-button" disabled={extractingTheme} onClick={() => void applyExtractedPalette(preview)}>
                <Icon name="auto_awesome" size={15} />
                {extractingTheme ? 'Generating…' : 'Generate from logo'}
              </button>
            )}
          </div>
          <span className="company-settings-hint">Used on buttons, links and highlights across your workspace.</span>
        </div>
      </section>

      <section id="contact" className="company-settings-section">
        <div className="company-settings-section-heading">
          <div>
            <strong>Contact details</strong>
            <span>Primary business contact information.</span>
          </div>
        </div>
        <div className="company-settings-grid company-settings-grid-2">
          <SettingsField label="Company email" hint="Shown on supported documents as the contact email">
            <input type="email" value={values.email} onChange={(e) => setValue('email', e.target.value)} disabled={!canEdit} placeholder="info@example.com" />
          </SettingsField>
          <SettingsField label="Company phone">
            <input value={values.phone} onChange={(e) => setValue('phone', e.target.value)} disabled={!canEdit} placeholder="+256 700 000 000" />
          </SettingsField>
          <SettingsField label="Alternate phone">
            <input value={values.alternate_phone} onChange={(e) => setValue('alternate_phone', e.target.value)} disabled={!canEdit} placeholder="+256 700 000 000" />
          </SettingsField>
          <SettingsField label="Website" hint="A secure https:// address is recommended">
            <input type="url" value={values.website} onChange={(e) => setValue('website', e.target.value)} disabled={!canEdit} placeholder="https://example.com" />
          </SettingsField>
        </div>
      </section>

      <section id="location" className="company-settings-section">
        <div className="company-settings-section-heading">
          <div>
            <strong>Address & Location</strong>
            <span>Used as the company address on supported documents.</span>
          </div>
        </div>
        <div className="company-settings-grid company-settings-grid-2">
          <SettingsField label="Country" required>
            <input value={values.country} onChange={(e) => setValue('country', e.target.value)} disabled={!canEdit} placeholder="Uganda" />
          </SettingsField>
          <SettingsField label="City">
            <input value={values.city} onChange={(e) => setValue('city', e.target.value)} disabled={!canEdit} placeholder="Kampala" />
          </SettingsField>
        </div>
        <SettingsField label="Physical address">
          <input value={values.address} onChange={(e) => setValue('address', e.target.value)} disabled={!canEdit} placeholder="Street, building, district" />
        </SettingsField>
        <div className="company-settings-grid company-settings-grid-2">
          <SettingsField label="Tax Identification Number (TIN)">
            <input value={values.tax_identification_number} onChange={(e) => setValue('tax_identification_number', e.target.value)} disabled={!canEdit} placeholder="TIN" />
          </SettingsField>
          <SettingsField label="Registration number">
            <input value={values.registration_number} onChange={(e) => setValue('registration_number', e.target.value)} disabled={!canEdit} placeholder="Registration number" />
          </SettingsField>
        </div>
      </section>

      <section id="regional" className="company-settings-section">
        <div className="company-settings-section-heading">
          <div>
            <strong>Regional settings</strong>
            <span>Defaults used for currency, time and operating status.</span>
          </div>
        </div>
        <div className="company-settings-grid company-settings-grid-2">
          <SettingsField label="Currency">
            <input value={values.currency} onChange={(e) => setValue('currency', e.target.value.toUpperCase())} disabled={!canEdit} placeholder="UGX" />
          </SettingsField>
          <SettingsField label="Timezone">
            <input value={values.timezone} onChange={(e) => setValue('timezone', e.target.value)} disabled={!canEdit} placeholder="Africa/Kampala" />
          </SettingsField>
        </div>
        <label className="company-active-toggle">
          <input type="checkbox" checked={values.is_active} onChange={(e) => setValue('is_active', e.target.checked)} disabled={!canEdit} />
          <span>
            <strong>Company profile is active</strong>
            <small>Keep this enabled for normal ERP operations.</small>
          </span>
        </label>
      </section>

      {canEdit && (
        <div className="company-settings-savebar">
          <div>
            <Icon name="lock" size={14} />
            Changes are saved to the existing company profile.
          </div>
          <button type="submit" disabled={saving}>
            <Icon name="save" size={16} />
            {saving ? 'Saving…' : hotel ? 'Save changes' : 'Create company profile'}
          </button>
        </div>
      )}
    </form>
  )
}

export default function HotelProfile() {
  const app = useApp()
  const [hotels, setHotels] = useState<HotelRecord[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const canEdit = app.user.isStaff

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const rows = await fetchHotels()
      setHotels(rows)
      setSelectedId((current) => current && rows.some((row) => String(row.id) === current) ? current : (rows[0] ? String(rows[0].id) : ''))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const selectedHotel = creating ? null : (hotels.find((hotel) => String(hotel.id) === selectedId) || hotels[0] || null)

  const saved = (hotel: HotelRecord) => {
    setHotels((current) => {
      const found = current.some((item) => item.id === hotel.id)
      return found ? current.map((item) => item.id === hotel.id ? hotel : item) : [hotel, ...current]
    })
    setSelectedId(String(hotel.id))
    setCreating(false)
    app.showToast(hotels.some((item) => item.id === hotel.id) ? 'Company profile updated' : 'Company profile created')
  }

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="enterprise-workspace hotel-profile-screen company-settings-screen">
      <div className="company-settings-pagehead">
        <div>
          <h1>{creating ? 'New Company Profile' : 'Company Settings'}</h1>
          <p>Identity, branding, contact information and operating defaults</p>
        </div>
        <div className="company-settings-page-actions">
          {hotels.length > 1 && !creating && (
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label="Select hotel profile">
              {hotels.map((hotel) => <option key={hotel.id} value={String(hotel.id)}>{hotel.name}</option>)}
            </select>
          )}
          {canEdit && hotels.length > 0 && (
            <button type="button" className="company-settings-new" onClick={() => setCreating((value) => !value)}>
              <Icon name={creating ? 'close' : 'add'} size={16} />
              {creating ? 'Cancel' : 'Add property'}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="company-settings-state">
          <Icon name="progress_activity" size={24} />
          <strong>Loading company settings…</strong>
        </div>
      )}

      {!loading && error && (
        <div className="company-settings-state company-settings-state-error">
          <Icon name="cloud_off" size={26} />
          <strong>Could not load company settings</strong>
          <span>{error}</span>
          <button onClick={() => void load()}>Try again</button>
        </div>
      )}

      {!loading && !error && (
        <div className="company-settings-layout">
          <aside className="company-settings-nav" aria-label="Company settings sections">
            <div className="company-settings-nav-title">Settings</div>
            {settingsNav.map((item, index) => (
              <button key={item.id} className={index === 0 ? 'active' : ''} onClick={() => scrollTo(item.id)}>
                <Icon name={item.icon} size={15} />
                <span>{item.label}</span>
              </button>
            ))}
            <div className="company-settings-nav-spacer" />
            <div className="company-settings-nav-meta">
              <Icon name="apartment" size={15} />
              <span>
                <strong>{selectedHotel?.branch_count ?? 0}</strong>
                configured {selectedHotel?.branch_count === 1 ? 'branch' : 'branches'}
              </span>
            </div>
          </aside>

          <main className="company-settings-content">
            {!selectedHotel && !creating && !canEdit ? (
              <div className="company-settings-state">
                <Icon name="domain_disabled" size={28} />
                <strong>No company profile is available.</strong>
                <span>An administrator must create the company profile.</span>
              </div>
            ) : (
              <CompanySettingsForm hotel={selectedHotel} canEdit={canEdit} onSaved={saved} />
            )}
          </main>
        </div>
      )}
    </div>
  )
}
