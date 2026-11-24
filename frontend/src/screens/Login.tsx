import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useApp } from '../state/AppContext'
import { passwordRecovery } from '../lib/api'

export default function Login() {
  const {login,authMessage}=useApp()
  const userId=useId(), passId=useId(), emailId=useId(), newId=useId(), confirmId=useId()
  const [mode,setMode]=useState<'login'|'request'|'confirm'>('login')
  const [credentials,setCredentials]=useState<{uid:string;token:string}|null>(null)
  const [username,setUsername]=useState(''),[password,setPassword]=useState('')
  const [email,setEmail]=useState(''),[nextPassword,setNextPassword]=useState(''),[confirmation,setConfirmation]=useState('')
  const [remember,setRemember]=useState(false),[showPassword,setShowPassword]=useState(false),[caps,setCaps]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
  const running=useRef(false), loginInput=useRef<HTMLInputElement>(null), resetInput=useRef<HTMLInputElement>(null)
  useEffect(()=>{
    const params=new URLSearchParams(window.location.hash.slice(1))
    const uid=params.get('uid'),token=params.get('token')
    if(uid&&token){setCredentials({uid,token});setMode('confirm');window.history.replaceState(null,'',window.location.pathname+window.location.search)}
  },[])
  useEffect(()=>{(mode==='login'?loginInput:resetInput).current?.focus()},[mode])
  const switchMode=(value:'login'|'request'|'confirm')=>{
    if(running.current)return
    setError('');setNotice('');setPassword('');setNextPassword('');setConfirmation('');setShowPassword(false);setCaps(false)
    if(value==='request'&&username.includes('@'))setEmail(username)
    if(value==='login')setCredentials(null)
    setMode(value)
  }
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(running.current)return
    running.current=true;setBusy(true);setError('');setNotice('')
    try{
      if(mode==='login'){
        if(!username.trim()||!password)throw Error('Enter your username or email and password.')
        await login(username.trim(),password,remember)
        const destination=new URLSearchParams(window.location.search).get('next')
        if(destination&&destination.startsWith('/')&&!destination.startsWith('//')&&!destination.includes('\\'))window.location.assign(destination)
      }else if(mode==='request'){
        await passwordRecovery('request',{email:email.trim()})
        setNotice('If an eligible account matches this email address, password reset instructions will be sent. Check your inbox and spam folder.')
      }else{
        if(!credentials)throw Error('This reset link is invalid. Request a new link.')
        if(nextPassword!==confirmation)throw Error('Passwords do not match.')
        await passwordRecovery('confirm',{...credentials,password:nextPassword})
        setCredentials(null);setNextPassword('');setConfirmation('');setMode('login');setNotice('Password changed successfully. Sign in with your new password.')
      }
    }catch(cause){const message=cause instanceof Error?cause.message:'Unable to complete the request.';setError(/failed to fetch|networkerror/i.test(message)?'The hotel authentication server is not reachable.':message)}
    finally{running.current=false;setBusy(false)}
  }
  const detectCaps=(event:KeyboardEvent<HTMLInputElement>)=>setCaps(event.getModifierState('CapsLock'))
  return <main className="hotel-auth-page">
    <div className="hotel-auth-stage">
      <svg className="hotel-auth-art" viewBox="0 0 1060 600" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="hotelAuthGreen" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#075b42"/><stop offset=".55" stopColor="#108253"/><stop offset="1" stopColor="#77cfa1"/></linearGradient></defs>
        <path fill="url(#hotelAuthGreen)" d="M0 0H423C490 123 460 250 635 337C771 402 936 395 1060 485V600H0Z"/>
        <g fill="none" stroke="#82c4a4" strokeWidth="1.7" opacity=".32">
          <path d="M0 85L90 240 163 205 235 306 202 397 90 283 90 240 0 85 163 205 136 245 235 306 202 397 136 245 90 283M230 410L265 389 322 426 391 445 351 461 288 438 230 410 322 426 351 461M448 452L474 459 456 472ZM485 467L506 458 499 480ZM551 485L568 492 584 508 584 483ZM669 489L706 460 715 481Z"/>
          <path d="M807 299L846 275 887 292 870 330 807 299 840 326 870 330 932 373 1009 301 1060 328M840 326L861 341 932 373 1009 301 1028 359 1060 328M932 373L1002 410 1028 359 1060 475 1002 410 1000 481 1060 475M782 338L816 340 794 359ZM917 279L942 301 932 310Z"/>
        </g>
      </svg>
      <div className="hotel-auth-brand"><span aria-hidden="true"/>HOTEL <b>ERP</b></div>
      <div className="hotel-auth-perspective">
        <div className={'hotel-auth-flipper'+(mode!=='login'?' is-flipped':'')}>
          <section className="hotel-auth-card hotel-auth-front" aria-hidden={mode!=='login'} inert={mode!=='login'}>
            <h1>LOGIN</h1>
            {mode==='login'&&<>{authMessage&&!notice&&<p role="status" className="hotel-auth-notice">{authMessage}</p>}{notice&&<p role="status" className="hotel-auth-notice">{notice}</p>}{error&&<p role="alert" className="hotel-auth-error">{error}</p>}</>}
            <form onSubmit={submit}>
              <label htmlFor={userId}>Username or email</label>
              <input ref={loginInput} id={userId} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="Enter your username or email" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy||mode!=='login'} required/>
              <label htmlFor={passId}>Password</label>
              <div className="hotel-auth-password"><input id={passId} name="password" type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Your password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={detectCaps} onKeyUp={detectCaps} disabled={busy||mode!=='login'} required/><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?'Hide password':'Show password'} disabled={busy}>{showPassword?'Hide':'Show'}</button></div>
              {caps&&<small className="hotel-auth-error">Caps Lock is on</small>}
              <div className="hotel-auth-options"><label><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} disabled={busy}/> Remember me</label><button type="button" onClick={()=>switchMode('request')} disabled={busy}>Forgot password?</button></div>
              <button className="hotel-auth-submit" type="submit" disabled={busy||mode!=='login'}>{busy&&mode==='login'?'Signing in…':'LOGIN'}</button>
            </form>
          </section>
          <section className="hotel-auth-card hotel-auth-back" aria-hidden={mode==='login'} inert={mode==='login'}>
            <h1>{mode==='confirm'?'Choose a new password':'Reset your password'}</h1>
            <p className="hotel-auth-instruction">{mode==='confirm'?'Enter and confirm your new password.':'Enter your email address to receive password reset instructions.'}</p>
            {mode!=='login'&&<>{error&&<p role="alert" className="hotel-auth-error">{error}</p>}{notice&&<p role="status" className="hotel-auth-notice">{notice}</p>}</>}
            <form onSubmit={submit}>
              {mode==='confirm'?<><label htmlFor={newId}>New password</label><input ref={resetInput} id={newId} type="password" autoComplete="new-password" minLength={8} value={nextPassword} onChange={e=>setNextPassword(e.target.value)} required disabled={busy}/><label htmlFor={confirmId}>Confirm password</label><input id={confirmId} type="password" autoComplete="new-password" value={confirmation} onChange={e=>setConfirmation(e.target.value)} required disabled={busy}/></>:<><label htmlFor={emailId}>Email address</label><input ref={resetInput} id={emailId} type="email" autoComplete="email" placeholder="Your email address" value={email} onChange={e=>setEmail(e.target.value)} required disabled={busy||mode==='login'}/></>}
              <button className="hotel-auth-submit" type="submit" disabled={busy||mode==='login'}>{busy?'Please wait…':mode==='confirm'?'RESET PASSWORD':'SEND RESET LINK'}</button>
              <button className="hotel-auth-back-link" type="button" onClick={()=>switchMode('login')} disabled={busy}>Back to Login</button>
            </form>
          </section>
        </div>
      </div>
    </div>
    <small className="hotel-auth-credit">Powered by Tafiti Automate</small>
  </main>
}
