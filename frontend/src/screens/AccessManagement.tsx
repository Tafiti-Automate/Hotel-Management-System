import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import RecordDetailDrawer from '../components/RecordDetailDrawer'
import { useApp } from '../state/AppContext'
import {
  errorMessage, fetchAccounts, fetchRoles, saveAccount,
  type AccountRecord, type RoleRecord,
} from '../lib/api'
import { normalizeUgandaPhone, UGANDA_PHONE_HINT } from '../lib/ugandaPhone'

type Tab = 'accounts' | 'roles'
type AccountDraft = Partial<AccountRecord> & { password?: string; role?: string }

const emptyAccount: AccountDraft = { username: '', first_name: '', last_name: '', email: '', employee_code: '', phone: '', account_type: 'system', role: '', password: '', is_active: true, is_staff: true }

export default function AccessManagement() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('accounts')
  const [accounts, setAccounts] = useState<AccountRecord[]>([])
  const [roles, setRoles] = useState<RoleRecord[]>([])
  const [term, setTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedAccessRecord, setSelectedAccessRecord] = useState<{ title: string; subtitle: string; record: Record<string, unknown> } | null>(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const [nextAccounts, nextRoles] = await Promise.all([fetchAccounts(), fetchRoles()])
      setAccounts(nextAccounts); setRoles(nextRoles)
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const visibleAccounts = useMemo(() => accounts.filter((account) =>
    [account.username, account.first_name, account.last_name, account.email, account.employee_code, account.role_name]
      .some((value) => String(value || '').toLowerCase().includes(term.toLowerCase()))
  ), [accounts, term])
  const visibleRoles = useMemo(() => roles.filter((role) => role.name.toLowerCase().includes(term.toLowerCase())), [roles, term])
  const activeCount = accounts.filter((account) => account.is_active).length

  const editAccount = (account?: AccountRecord) => {
    setAccountDraft(account
      ? { ...account, role: roles.find((role) => role.name === account.role_name)?.id || '', password: '' }
      : { ...emptyAccount })
  }
  const submitAccount = async () => {
    if (!accountDraft?.username) return
    setSaving(true)
    try {
      const payload = { ...accountDraft }
      try { payload.phone = normalizeUgandaPhone(payload.phone) }
      catch { throw new Error(UGANDA_PHONE_HINT) }
      if (!payload.password) delete payload.password
      await saveAccount(accountDraft.id || null, payload)
      setAccountDraft(null); await load(); app.showToast(accountDraft.id ? 'User account updated' : 'User account created')
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setSaving(false) }
  }
  const toggleAccount = async (account: AccountRecord) => {
    try {
      await saveAccount(account.id, { is_active: !account.is_active })
      await load(); app.showToast(account.is_active ? 'Account suspended' : 'Account activated')
    } catch (reason) { setError(errorMessage(reason)) }
  }



  return <div className="access-page">
    <div className="access-heading">
      <div>
        <h1>Roles & system access</h1>
        <p>Manage user accounts, role assignments and access status.</p>
      </div>
      {tab === 'accounts' && <button className="access-primary" onClick={() => editAccount()}>
        <Icon name="person_add" size={18} color="#fff" />
        Add system account
      </button>}
    </div>

    <div className="access-stats">
      <Stat icon="group" label="Total accounts" value={accounts.length} note={`${activeCount} currently active`} />
      <Stat icon="verified_user" label="Workflow roles" value={roles.length} note="Configured access profiles" />
      <Stat icon="shield_person" label="Administrators" value={accounts.filter((account) => account.role_name === 'System Administrator').length} note="Full system access" />
    </div>

    <section className="access-card">
      <div className="access-card-top">
        <div className="access-tabs">
          <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}><Icon name="manage_accounts" size={18} />User accounts <span>{accounts.length}</span></button>
          <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}><Icon name="admin_panel_settings" size={18} />Roles <span>{roles.length}</span></button>
        </div>
        <div className="access-search"><Icon name="search" size={18} /><input value={term} onChange={(event) => setTerm(event.target.value)} placeholder={`Search ${tab}`} /></div>
        <button className="access-icon-button" onClick={() => void load()} title="Refresh"><Icon name="refresh" size={18} /></button>
      </div>

      {error && <div className="access-error"><Icon name="error" size={17} />{error}<button onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}
      {loading ? <div className="access-empty">Loading access controls…</div> : tab === 'accounts' ? <>
        <div className="access-table-head account-grid"><span>User</span><span>Account</span><span>Role</span><span>Last sign-in</span><span>Status</span><span /></div>
        {visibleAccounts.map((account) => <div className="access-table-row account-grid" key={account.id} role="button" tabIndex={0} onClick={() => setSelectedAccessRecord({ title: 'User account', subtitle: fullName(account), record: { ...account } })} onKeyDown={(event) => { if (event.key === 'Enter') setSelectedAccessRecord({ title: 'User account', subtitle: fullName(account), record: { ...account } }) }} style={{ cursor: 'pointer' }}>
          <div className="access-person"><span className="access-avatar">{initials(account)}</span><span><b>{fullName(account)}</b><small>{account.email || `@${account.username}`}</small></span></div>
          <span><code>{account.employee_code || '—'}</code><small style={{ display: 'block', marginTop: 3, color: 'var(--text-faint)' }}>{account.linked_employee ? account.linked_employee.department : 'System account'}</small></span>
          <span className="access-role"><Icon name="shield" size={15} />{account.role_name}</span>
          <span className="muted">{account.last_login ? new Date(account.last_login).toLocaleDateString() : 'Never'}</span>
          <span className={`access-status ${account.is_active ? 'active' : 'inactive'}`}>{account.is_active ? 'Active' : 'Suspended'}</span>
          <div className="access-row-actions"><button title="Edit account" onClick={(event) => { event.stopPropagation(); editAccount(account) }}><Icon name="edit" size={17} /></button><button title={account.is_active ? 'Suspend account' : 'Activate account'} onClick={(event) => { event.stopPropagation(); void toggleAccount(account) }}><Icon name={account.is_active ? 'block' : 'check_circle'} size={17} /></button></div>
        </div>)}
        {!visibleAccounts.length && <div className="access-empty">No user accounts match your search.</div>}
      </> : <>
        <div className="access-table-head role-grid"><span>Role</span><span>Users</span><span>Permissions</span><span>Access level</span><span /></div>
        {visibleRoles.map((role) => <div className="access-table-row role-grid" key={role.id} role="button" tabIndex={0} onClick={() => setSelectedAccessRecord({ title: 'Access role', subtitle: role.name, record: { ...role } })} onKeyDown={(event) => { if (event.key === 'Enter') setSelectedAccessRecord({ title: 'Access role', subtitle: role.name, record: { ...role } }) }} style={{ cursor: 'pointer' }}>
          <div className="access-person"><span className="access-role-icon"><Icon name="admin_panel_settings" size={20} /></span><span><b>{role.name}</b><small>Hotel access role</small></span></div>
          <span className="muted">{role.user_count} user{role.user_count === 1 ? '' : 's'}</span>
          <span className="muted">{role.permission_ids.length} permissions</span>
          <span className="access-role"><Icon name="lock" size={15} />Configured role</span>
          <div className="access-row-actions"><span title="Role permissions are centrally managed"><Icon name="lock" size={17} /></span></div>
        </div>)}
        {!visibleRoles.length && <div className="access-empty">No roles match your search.</div>}
      </>}
    </section>

    {selectedAccessRecord && <RecordDetailDrawer title={selectedAccessRecord.title} subtitle={selectedAccessRecord.subtitle} record={selectedAccessRecord.record} onClose={() => setSelectedAccessRecord(null)} />}

    {accountDraft && <Modal title={accountDraft.id ? 'Edit account' : 'Add system account'} subtitle={accountDraft.id ? 'Sign-in status and role assignment' : 'Create an account and assign the required access role'} onClose={() => setAccountDraft(null)}>
      <div className="access-form-grid">
        <Field label="First name"><input value={accountDraft.first_name || ''} onChange={(e) => setAccountDraft({ ...accountDraft, first_name: e.target.value })} /></Field>
        <Field label="Last name"><input value={accountDraft.last_name || ''} onChange={(e) => setAccountDraft({ ...accountDraft, last_name: e.target.value })} /></Field>
        <Field label="Username" required><input value={accountDraft.username || ''} onChange={(e) => setAccountDraft({ ...accountDraft, username: e.target.value })} /></Field>
        {accountDraft.id && <Field label="Account reference"><input disabled value={accountDraft.employee_code || ''} /></Field>}
        <Field label="Email address"><input type="email" value={accountDraft.email || ''} onChange={(e) => setAccountDraft({ ...accountDraft, email: e.target.value })} /></Field>
        <Field label="Phone number"><input value={accountDraft.phone || ''} onChange={(e) => setAccountDraft({ ...accountDraft, phone: e.target.value })} /></Field>
        <Field label="Role"><select value={accountDraft.role || ''} onChange={(e) => setAccountDraft({ ...accountDraft, role: e.target.value })}><option value="">Select role</option>{roles.filter((role) => accountDraft.id || ['administrator', 'system administrator', 'platform administrator', 'technical support', 'implementation consultant'].includes(role.name.toLowerCase())).map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></Field>
        <Field label={accountDraft.id ? 'New password (optional)' : 'Temporary password'}><input type="password" value={accountDraft.password || ''} onChange={(e) => setAccountDraft({ ...accountDraft, password: e.target.value })} /></Field>
      </div>
      <label className="access-check"><input type="checkbox" checked={Boolean(accountDraft.is_active)} onChange={(e) => setAccountDraft({ ...accountDraft, is_active: e.target.checked })} /><span><b>Account is active</b><small>User can sign in immediately.</small></span></label>
      <ModalActions saving={saving} onCancel={() => setAccountDraft(null)} onSave={() => void submitAccount()} label={accountDraft.id ? 'Save changes' : 'Create system account'} />
    </Modal>}

  </div>
}

function Stat({ icon, label, value, note }: { icon: string; label: string; value: number; note: string }) {
  return <div className="access-stat"><span><Icon name={icon} size={21} /></span><div><small>{label}</small><b>{value}</b><em>{note}</em></div></div>
}
function initials(account: AccountRecord) { return `${account.first_name?.[0] || account.username[0] || ''}${account.last_name?.[0] || ''}`.toUpperCase() }
function fullName(account: AccountRecord) { return `${account.first_name} ${account.last_name}`.trim() || account.username }
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="access-field"><span>{label}{required && <i>*</i>}</span>{children}</label> }
function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) { return <div className="access-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><section className="access-modal"><header><span><h2>{title}</h2><p>{subtitle}</p></span><button onClick={onClose}><Icon name="close" size={20} /></button></header><div className="access-modal-body">{children}</div></section></div> }
function ModalActions({ saving, onCancel, onSave, label }: { saving: boolean; onCancel: () => void; onSave: () => void; label: string }) { return <div className="access-modal-actions"><button onClick={onCancel}>Cancel</button><button className="access-primary" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : label}</button></div> }
