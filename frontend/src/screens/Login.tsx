import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Icon } from '../components/Icon'
import { useApp } from '../state/AppContext'

type Language='English'|'French'
const strings={
  English:{user:'User Name',password:'Password',database:'Database / Property',language:'Language',
    ok:'OK',cancel:'Cancel',title:'Materials Control',prompt:'Enter your staff credentials to open your authorised property.',
    invalid:'Enter both your user name and password.',caps:'Caps Lock is on'},
  French:{user:'Identifiant',password:'Mot de passe',database:'Base de données / Établissement',language:'Langue',
    ok:'Valider',cancel:'Annuler',title:'Contrôle des matières',prompt:'Saisissez vos identifiants pour accéder à votre établissement.',
    invalid:'Saisissez votre identifiant et votre mot de passe.',caps:'Verr. Maj. activé'},
}

export default function Login() {
  const { login, authMessage, data }=useApp()
  const userId=useId(),passId=useId()
  const [username,setUsername]=useState('')
  const [password,setPassword]=useState('')
  const [property,setProperty]=useState('assigned')
  const [language,setLanguage]=useState<Language>('English')
  const [caps,setCaps]=useState(false)
  const [remember,setRemember]=useState(true)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const t=strings[language]
  useEffect(()=>{
    const onKey=(e:globalThis.KeyboardEvent)=>{
      if(e.key==='Escape'&&document.activeElement instanceof HTMLElement){
        setUsername('');setPassword('');setError('')
      }
    }
    window.addEventListener('keydown',onKey)
    return ()=>window.removeEventListener('keydown',onKey)
  },[])
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault()
    if(busy)return
    if(!username.trim()||!password){setError(t.invalid);return}
    setBusy(true);setError('')
    try{
      // The assigned property is verified server-side, never selected by trusting
      // an unauthenticated browser-supplied property name.
      await login(username.trim(),password,remember)
      const destination=new URLSearchParams(window.location.search).get('next')
      if(destination && destination.startsWith('/') && !destination.startsWith('//') && !destination.includes('\\')) {
        window.location.assign(destination)
      }
    }catch(cause){
      const message=cause instanceof Error?cause.message:'Authentication unsuccessful'
      setError(/failed to fetch|networkerror/i.test(message)
        ?'The hotel authentication server is not reachable.':message)
    }finally{setBusy(false)}
  }
  const detectCaps=(event:KeyboardEvent<HTMLInputElement>)=>setCaps(event.getModifierState('CapsLock'))
  return <main className="mc-login-backdrop">
    <section className="mc-login-window" aria-label="Hotel Materials Control sign-on">
      <div className="mc-login-topline"><span className="mc-login-icon"><Icon name="inventory_2" size={20}/></span>
        <div><strong>HOSPITALITY MATERIALS CONTROL</strong><small>Hotel ERP · Enterprise staff sign-on</small></div>
        <span className="mc-login-version">MC / Web</span></div>
      <div className="mc-login-heading">
        <h1>{t.title}</h1><p>{t.prompt}</p>
      </div>
      {authMessage&&<div className="mc-login-message">{authMessage}</div>}
      {error&&<div className="mc-login-error" role="alert">{error}</div>}
      <form onSubmit={submit} className="mc-login-form">
        <label htmlFor={userId}>{t.user}</label><input id={userId} name="username" autoFocus autoComplete="username"
          autoCapitalize="none" spellCheck={false} value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/>
        <label htmlFor={passId}>{t.password}</label><input id={passId} name="password" type="password"
          autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}
          onKeyDown={detectCaps} onKeyUp={detectCaps} disabled={busy}/>
        <label htmlFor="mc-property-select">{t.database}</label>
        <select id="mc-property-select" value={property} onChange={e=>setProperty(e.target.value)} disabled={busy}>
          <option value="assigned">AUTO — Authenticated assigned property</option>
          {data.branches.map(branch=><option value={String(branch.id)} key={String(branch.id)}>{String(branch.name)}</option>)}
        </select>
        <label htmlFor="mc-language-select">{t.language}</label>
        <select id="mc-language-select" value={language} onChange={e=>setLanguage(e.target.value as Language)} disabled={busy}>
          <option value="English">English</option><option value="French">Français</option>
        </select>
        {caps&&<div className="mc-login-caps">{t.caps}</div>}
        <div className="mc-login-remember"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Keep me signed in on this device</label></div>
        <div className="mc-login-buttons"><button type="submit" className="mc-login-ok" disabled={busy}>
          {busy?'Signing in…':t.ok}</button>
          <button type="button" className="mc-login-cancel" disabled={busy} onClick={()=>{setUsername('');setPassword('');setError('');setProperty('assigned')}}>{t.cancel}</button>
        </div>
      </form>
      <footer className="mc-login-footer"><span><Icon name="lock" size={13}/> Staff-only access · role & property controlled</span><span>© Hotel ERP</span></footer>
    </section>
    <div className="mc-login-credit">Materials Control–inspired enterprise interface. Not an Oracle product.</div>
  </main>
}
