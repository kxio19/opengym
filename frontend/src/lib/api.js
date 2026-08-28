// Backend + WebAuthn helpers (ported from the vanilla app).
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
export const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials)

export async function api(path, opts) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
export async function passkeyRegister(name, code, termsAccepted = false) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '', termsAccepted }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}

export async function passkeyAdd(label) {
  const { cid, options } = await api('/api/passkeys/options', { method: 'POST', body: JSON.stringify({ label }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  return api('/api/passkeys/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
}

// A profile with a passkey confirms with it. One that only ever had a password/PIN confirms with
// that instead — without this path such a profile could never mint the codes that are its only
// way back if the password is lost.
export async function regenerateRecoveryCodes(secret) {
  if (secret !== undefined) return api('/api/recovery/regenerate', { method: 'POST', body: JSON.stringify({ secret }) })
  const { cid, options } = await api('/api/recovery/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  return api('/api/recovery/regenerate', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
}

export async function recoveryLogin(code) {
  return api('/api/recovery/login', { method: 'POST', body: JSON.stringify({ code }) })
}

export async function passwordRegister(name, secret, code, termsAccepted = false) {
  const res = await api('/api/password/register', { method: 'POST', body: JSON.stringify({ name, secret, code: code || '', termsAccepted }) })
  return res.user
}

export async function passwordLogin(name, secret) {
  const res = await api('/api/password/login', { method: 'POST', body: JSON.stringify({ name, secret }) })
  return res.user
}

export async function passwordSetWithPasskey(secret) {
  const { cid, options } = await api('/api/password/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/password/set', { method: 'POST', body: JSON.stringify({ cid, secret, credential: credToJSON(cred) }) })
  return res.user
}

export async function passwordChange(currentSecret, newSecret) {
  const res = await api('/api/password/change', { method: 'POST', body: JSON.stringify({ currentSecret, newSecret }) })
  return res.user
}
