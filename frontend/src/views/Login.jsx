import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, recoveryLogin, passwordLogin, passwordRegister, api, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, Switch } from '../components/ui.jsx'

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0)).buffer
const passkeyCredentialJSON = credential => ({
  id: credential.id,
  rawId: bufToB64u(credential.rawId),
  type: credential.type,
  clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
  authenticatorAttachment: credential.authenticatorAttachment || null,
  response: {
    clientDataJSON: bufToB64u(credential.response.clientDataJSON),
    attestationObject: bufToB64u(credential.response.attestationObject),
    transports: credential.response.getTransports ? credential.response.getTransports() : ['internal'],
  },
})

async function requestPasskeyRegistration(name, termsAccepted) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: '', termsAccepted, requestAccess: true }) })
  options.challenge = b64uToBuf(options.challenge)
  options.user.id = b64uToBuf(options.user.id)
  ;(options.excludeCredentials || []).forEach(credential => { credential.id = b64uToBuf(credential.id) })
  const credential = await navigator.credentials.create({ publicKey: options })
  return api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: passkeyCredentialJSON(credential) }) })
}

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [method, setMethod] = useState('password')
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [requestAccess, setRequestAccess] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const ref = useRef(null)
  const passwordReady = method !== 'password' || (!!secret && !!confirm)
  const canSubmit = termsAccepted && !!name.trim() && passwordReady && (!inviteOnly || requestAccess || !!code.trim())
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !requestAccess && !code.trim()) { useUI.getState().toast(t('Enter an invite code or request access')); return }
    if (!termsAccepted) { useUI.getState().toast(t('Accept the private group terms to continue')); return }
    if (method === 'password' && !secret) { useUI.getState().toast(t('Enter a password or PIN')); return }
    if (method === 'password' && !confirm) { useUI.getState().toast(t('Repeat your password or PIN')); return }
    if (method === 'password' && /^\d+$/.test(secret) && (secret.length < 6 || secret.length > 12)) { useUI.getState().toast(t('PIN must contain 6 to 12 digits')); return }
    if (method === 'password' && !/^\d+$/.test(secret) && (secret.length < 8 || secret.length > 128)) { useUI.getState().toast(t('Password must contain 8 to 128 characters')); return }
    if (method === 'password' && secret !== confirm) { useUI.getState().toast(t('Password/PIN values do not match')); return }
    try {
      if (requestAccess) {
        if (method === 'password') await api('/api/password/register', { method: 'POST', body: JSON.stringify({ name: n, secret, code: '', termsAccepted, requestAccess: true }) })
        else await requestPasskeyRegistration(n, termsAccepted)
        setWaiting(true)
        return
      }
      const u = method === 'password' ? await passwordRegister(n, secret, code.trim(), termsAccepted) : await passkeyRegister(n, code.trim(), termsAccepted)
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  if (waiting) return <>
    <h3>{t('Request awaiting approval')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Your profile has been created, but you cannot sign in until an administrator approves it.')}</div>
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
  return <>
    <h3>{t('Create your profile')}</h3>
    <Segmented options={[
      { value: 'password', label: t('Password or PIN') },
      ...(webauthnOK() ? [{ value: 'passkey', label: t('Passkey') }] : []),
    ]} value={method} onChange={setMethod} />
    <div className="muted small" style={{ margin: '12px 0 14px' }}>{method === 'password'
      ? t('Use a password of at least 8 characters, or a numeric PIN of 6 to 12 digits.')
      : t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', BIO)}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {method === 'password' && <>
      <div style={{ height: 10 }} />
      <input className="input" type="password" autoComplete="new-password" placeholder={t('Password or PIN')} maxLength={128} value={secret} onChange={e => setSecret(e.target.value)} />
      <div style={{ height: 10 }} />
      <input className="input" type="password" autoComplete="new-password" placeholder={t('Repeat password or PIN')} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('A short PIN is easier to guess. Passkeys remain the safer option.')}</div>
    </>}
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        disabled={requestAccess} onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
      <div className="social-toggle" style={{ marginTop: 10, textAlign: 'left' }}><div><b id="login-request-access-label">{t('Request access instead')}</b><div className="small muted">{t('An administrator will review your request before you can sign in.')}</div></div><Switch checked={requestAccess} onChange={setRequestAccess} aria-labelledby="login-request-access-label" /></div>
    </>}
    <div className="social-toggle" style={{ marginTop: 14, textAlign: 'left' }}><div><b id="login-private-group-label">{t('Private training group')}</b><div className="small muted">{t('I understand that my profile belongs to this private group. I choose what each workout publishes; imported and previous history stays private.')}</div></div><Switch checked={termsAccepted} onChange={setTermsAccepted} aria-labelledby="login-private-group-label" /></div>
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={!canSubmit} onClick={go}>{method === 'password' ? t('Create profile') : t('Create passkey')}</Button>
  </>
}

function RecoverySheet({ close }) {
  const { setUser, pullState } = useStore()
  const [code, setCode] = useState('')
  const go = async () => {
    if (!code.trim()) { useUI.getState().toast(t('Enter a recovery code')); return }
    try {
      const { user, recoveryCodesRemaining } = await recoveryLogin(code)
      setUser(user); await pullState(); close()
      useUI.getState().toast(t('Signed in — add a passkey on this device. {0} recovery codes remain.', recoveryCodesRemaining))
    } catch (e) { useUI.getState().toast(e.message || t('Recovery sign-in failed')) }
  }
  return <>
    <h3>{t('Use a recovery code')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Each code works once. After signing in, add a passkey for this device in Settings.')}</div>
    <input className="input" autoCapitalize="characters" autoCorrect="off" spellCheck="false" placeholder="OG-XXXX-XXXX-XXXX" maxLength={20}
      value={code} onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.08em', fontWeight: 600, textAlign: 'center' }} />
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Sign in')}</Button>
  </>
}

function PasswordLoginSheet({ close }) {
  const { setUser, pullState } = useStore()
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async () => {
    if (!name.trim() || !secret) { useUI.getState().toast(t('Enter your username and password/PIN')); return }
    try {
      const u = await passwordLogin(name.trim(), secret)
      setUser(u); await pullState(); close(); useUI.getState().toast(t('Welcome back, {0}', u.name))
    } catch (e) { useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  return <>
    <h3>{t('Sign in with username')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Use the name and password or PIN chosen when the profile was created.')}</div>
    <input ref={ref} className="input" autoComplete="username" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <input className="input" type="password" autoComplete="current-password" placeholder={t('Password or PIN')} maxLength={128} value={secret} onChange={e => setSecret(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} />
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Sign in')}</Button>
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
  }
  const head = <>
    <div style={{ fontSize: 54, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '10px 0 4px' }}>openGym</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
      {webauthnOK() && <>
        <Button variant="primary" icon="person" onClick={signIn}>{t('Sign in with passkey')}</Button>
        <div style={{ height: 10 }} />
      </>}
      <Button icon="person" onClick={() => useUI.getState().openSheet(close => <PasswordLoginSheet close={close} />)}>{t('Sign in with username')}</Button>
      <div style={{ height: 10 }} />
      <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Create new profile')}</Button>
      <div style={{ height: 10 }} />
      <Button variant="ghost" icon="key" onClick={() => useUI.getState().openSheet(close => <RecoverySheet close={close} />)}>{t('Use a recovery code')}</Button>
      <div style={{ height: 10 }} />
      <Button variant="ghost" className="dim" onClick={() => setGuest(true)}>{t('Continue without account')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Choose a passkey or a username with password/PIN.')}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
