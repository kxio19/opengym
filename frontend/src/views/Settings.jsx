import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ, fmtDate } from '../lib/format.js'
import { effortOf } from '../lib/history.js'
import { webauthnOK, passkeyLogin, passkeyRegister, passkeyAdd, regenerateRecoveryCodes, passwordLogin, passwordRegister, passwordSetWithPasskey, passwordChange, IS_ANDROID } from '../lib/api.js'
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { MOBILE, shareExport, syncReminder } from '../lib/mobile.js'
import { loadStarterPlan, confirmSheet, importFromApp } from '../sheets.jsx'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { forgetCoach } from '../lib/coach-api.js'
import Icon from '../components/Icon.jsx'
import SocialSettings from '../components/SocialSettings.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField } from '../components/ui.jsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const { update, replaceState, setUser, pullState, pushState, signOut, signOutAll, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const wakeOK = wakeLockSupported()

  const doExport = async () => {
    const json = JSON.stringify(S, null, 2)
    const name = 'opengym-backup-' + todayISO() + '.json'
    // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not an openGym backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceState(Object.assign(JSON.parse(JSON.stringify(DEF)), data), true); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} inviteOnly={!!config?.invite_only} />)
  const signInPasswordHere = () => useUI.getState().openSheet(close => <PasswordLoginInline close={close} setUser={setUser} pullState={pullState} toast={toast} />)
  const addPasskeyHere = () => useUI.getState().openSheet(close => <AddPasskeySheet close={close} toast={toast} setUser={setUser} />)
  const recoveryCodesHere = () => useUI.getState().openSheet(close => <RecoveryCodesSheet close={close} toast={toast} user={user} />)
  const passwordHere = () => useUI.getState().openSheet(close => <PasswordSettingsSheet close={close} toast={toast} user={user} setUser={setUser} />)
  // Ends the profile's sessions on every device — this one included, so on success it lands in
  // the same place as the plain sign-out above (home, local data cleared). On failure nothing
  // local is touched: still signed in here, and say so rather than leaving a half-signed-out app.
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Your passkeys keep working — sign in with them again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- account (demo and mobile builds have nothing to sign in to) ---------- */}
    <Section title={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')}>
      {MOBILE ? <>
        <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : DEMO ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : user ? <>
        <Row icon="personCircle" iconTint="var(--grey)" title={user.name} subtitle={t('Signed in — data syncs to this profile.')} />
        <Row icon="lock" iconTint="var(--purple)" title={user.hasPassword ? t('Change password or PIN') : t('Set password or PIN')} subtitle={user.hasPassword ? t('Update the reusable login for this profile.') : t('Keep this profile and sign in without a passkey.')} accessory="chevron" onClick={passwordHere} />
        {webauthnOK() && <Row icon="key" iconTint="var(--blue)" title={t('Add another passkey')} subtitle={t('Add this phone or choose another device with the system QR option.')} accessory="chevron" onClick={addPasskeyHere} />}
        {(user.hasPasskey || user.hasPassword) && <Row icon="shield" iconTint="var(--orange)" title={t('Recovery codes')} subtitle={t('One-time access when your usual way in is unavailable.')} accessory="chevron" onClick={recoveryCodesHere} />}
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
        <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
      </> : <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create new profile')} subtitle={t('Choose a passkey or a username with password/PIN.')} accessory="chevron" onClick={registerHere} />
        <Row icon="person" iconTint="var(--blue)" title={t('Sign in with username')} accessory="chevron" onClick={signInPasswordHere} />
        {webauthnOK() && <Row icon="key" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={signInHere} />}
      </>}
    </Section>
    {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

    {/* An administrator handed this profile a temporary password. Say so plainly and get it
        replaced: until it is, someone other than the owner knows a way in. */}
    {user?.mustChangeSecret && <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--red)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('Choose a new password or PIN')}</div>
      <div className="muted small" style={{ marginBottom: 10 }}>{t('An administrator set a temporary one so you could get back in. Replace it now — until you do, they know it too.')}</div>
      <Button variant="primary" onClick={passwordHere}>{t('Change password or PIN')}</Button>
    </div>}

    {/* One passkey, no password, no codes: losing this device loses the account. This is exactly
        how the first invited profile was set up, so it is worth saying out loud. */}
    {user && !user.mustChangeSecret && !user.hasPassword && !user.recoveryCodesLeft && (user.passkeyCount || 0) <= 1 &&
      <div className="card" style={{ marginBottom: 18, borderLeft: '3px solid var(--orange)' }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('This account has only one way in')}</div>
        <div className="muted small" style={{ marginBottom: 10 }}>{t('If you lose this device you lose the account. Generate recovery codes, or set a password/PIN, so there is a second way back.')}</div>
        <Button variant="primary" onClick={recoveryCodesHere}>{t('Generate recovery codes')}</Button>
      </div>}

    {/* Rescues are never silent: the person they were used on is told they happened. */}
    {user?.lastAdminRecovery && !user.mustChangeSecret &&
      <p className="sect-f" style={{ marginTop: -6, marginBottom: 22 }}>{t('An administrator restored access to this profile on {0}.', fmtDate(String(user.lastAdminRecovery).slice(0, 10)))}</p>}

    {user && <SocialSettings />}

    {/* ---------- general ---------- */}
    <Section title={t('General')} footer={t('Note: switching units only changes the label — logged numbers are not converted.')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={S.lang || 'es'} onChange={v => update(s => { s.lang = v; s.langDefaultEs = 1 })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => update(s => { s.unit = v })} />
      </Row>
    </Section>

    {/* ---------- during a workout ---------- */}
    <Section title={t('During a workout')} footer={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : null}>
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))} />
      {(wakeOK || !MOBILE) && (
        <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')} titleId="keep-screen-awake-label"
          subtitle={wakeOK ? null : t('Not supported in this browser.')}>
          <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK} aria-labelledby="keep-screen-awake-label"
            onChange={v => update(s => { s.keepAwake = v })} />
        </Row>
      )}
      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')} titleId="sounds-label">
        <Switch checked={!!S.sound} onChange={v => update(s => { s.sound = v })} aria-labelledby="sounds-label" />
      </Row>
      {/* Two names for the same judgement, so the column asks in the scale you already think in.
          The (i) sits before the control — you read it on the way to the choice, not after it. */}
      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
    </Section>

    {coachAvailable(config, user, { demo: DEMO, mobile: MOBILE }) && (
      <Section title={t('Coach')} footer={hasConsent(S)
        ? t('The Coach designs and adjusts your plan; it never changes anything without your say-so.')
        : t('An AI coach that can build your plan and adjust it from what you log. Off until you turn it on.')}>
        <Row icon="sparkles" iconTint="var(--acc)" title={hasConsent(S) ? t('Open the Coach') : t('Meet the Coach')}
          subtitle={hasConsent(S) ? t('Reviews, plan design, history and controls') : t('See what it would use, then decide')}
          accessory="chevron" onClick={() => nav('/coach')} />
      </Section>
    )}

    {(user || MOBILE) && <NotificationsCard S={S} update={update} toast={toast} />}

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' ? 'light' : 'dark'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => update(s => { s.accent = k })} aria-label={k} />
          ))}
        </div>
      </div>
    </Section>

    {/* ---------- data: fill it, bring things over, back it up, wipe it ---------- */}
    <Section title={t('Data')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Load starter plan (PPL)')} accessory="chevron" onClick={loadStarterPlan} />
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')} titleId="import-from-app-label"
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} titleId="import-backup-label" accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} accessory="chevron" onClick={doExport} />
      {/* Also drops anything the Coach is holding server-side: a wipe that leaves a pending
          proposal on the server behind would be a wipe in name only. */}
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { if (user) forgetCoach().catch(() => {}); replaceState(JSON.parse(JSON.stringify(DEF)), true); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} aria-labelledby="import-backup-label" />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }} aria-labelledby="import-from-app-label"
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    {/* "Add to Home screen" makes no sense inside the native app */}
    {!MOBILE && <Section title={t('Tip')}>
      <Row icon="lightbulb" iconTint="var(--yellow)"
        title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
        subtitle={t('to install openGym as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!'))} />
    </Section>}

    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      openGym · {t('free & open source (AGPL v3)')}<br />
      <a href={config?.source_url || 'https://github.com/kxio19/opengym'} target="_blank" rel="noopener">{t('source code')}</a> · exercise data: hasaneyldrm/exercises-dataset (CC)
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

function NotificationsCard({ S, update, toast }) {
  if (MOBILE) return <MobileReminderCard S={S} update={update} toast={toast} />
  return <PushCard S={S} update={update} toast={toast} />
}

// Mobile build: the reminder is a native local notification scheduled on planned weekdays —
// no push server involved. The schedule itself is (re)synced by the store on every persist;
// this card only owns the OS permission prompt when the switch turns on.
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section title={t('Notifications')}
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')} titleId="mobile-workout-reminder-label">
        <Switch checked={!!S.reminder?.on} onChange={toggle} aria-labelledby="mobile-workout-reminder-label" />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')} titleId="mobile-reminder-time-label">
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time} aria-labelledby="mobile-reminder-time-label"
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
    </Section>
  )
}

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  if (!supported) return (
    <Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      title={t('Notifications')}
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} titleId="push-notifications-label" subtitle={t('Rest-timer alerts, even if openGym is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle} aria-labelledby="push-notifications-label" />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')} titleId="web-workout-reminder-label">
          <Switch checked={!!S.reminder?.on} aria-labelledby="web-workout-reminder-label" onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')} titleId="web-reminder-time-label">
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time} aria-labelledby="web-reminder-time-label"
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}

function RegisterInline({ close, setUser, pushState, pullState, toast, inviteOnly }) {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [method, setMethod] = useState('password')
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const go = async () => {
    const n = name.trim()
    if (!n) { toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    if (!termsAccepted) { toast(t('Accept the private group terms to continue')); return }
    if (method === 'password' && secret !== confirm) { toast(t('Password/PIN values do not match')); return }
    try {
      const u = method === 'password' ? await passwordRegister(n, secret, code.trim(), termsAccepted) : await passkeyRegister(n, code.trim(), termsAccepted)
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <Segmented options={[
      { value: 'password', label: t('Password or PIN') },
      ...(webauthnOK() ? [{ value: 'passkey', label: t('Passkey') }] : []),
    ]} value={method} onChange={setMethod} />
    <div className="muted small" style={{ margin: '12px 0 14px' }}>{method === 'password'
      ? t('Use a password of at least 8 characters, or a numeric PIN of 6 to 12 digits.')
      : t('Pick a name, then confirm with your device.')}</div>
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Your name')} maxLength={40} />
    {method === 'password' && <>
      <div style={{ height: 10 }} /><TextField type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={t('Password or PIN')} maxLength={128} />
      <div style={{ height: 10 }} /><TextField type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={t('Repeat password or PIN')} maxLength={128} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('A short PIN is easier to guess. Passkeys remain the safer option.')}</div>
    </>}
    {inviteOnly && <>
      <div style={{ height: 10 }} /><TextField value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder={t('Invite code')} maxLength={40} />
    </>}
    <div className="social-toggle" style={{ marginTop: 14 }}><div><b id="settings-private-group-label">{t('Private training group')}</b><div className="small muted">{t('I understand that my profile belongs to this private group. I choose what each workout publishes; imported and previous history stays private.')}</div></div><Switch checked={termsAccepted} onChange={setTermsAccepted} aria-labelledby="settings-private-group-label" /></div>
    <div style={{ height: 12 }} /><Button variant="primary" disabled={!termsAccepted} onClick={go}>{method === 'password' ? t('Create profile') : t('Create passkey')}</Button>
  </>
}

function PasswordLoginInline({ close, setUser, pullState, toast }) {
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const go = async () => {
    if (!name.trim() || !secret) { toast(t('Enter your username and password/PIN')); return }
    try { const u = await passwordLogin(name.trim(), secret); setUser(u); await pullState(); close(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { toast(e.message || t('Sign-in failed')) }
  }
  return <>
    <h3>{t('Sign in with username')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Use the name and password or PIN chosen when the profile was created.')}</div>
    <TextField autoComplete="username" value={name} onChange={e => setName(e.target.value)} placeholder={t('Your name')} maxLength={40} />
    <div style={{ height: 10 }} /><TextField type="password" autoComplete="current-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={t('Password or PIN')} maxLength={128} onKeyDown={e => { if (e.key === 'Enter') go() }} />
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Sign in')}</Button>
  </>
}

function PasswordSettingsSheet({ close, toast, user, setUser }) {
  const [current, setCurrent] = useState('')
  const [secret, setSecret] = useState('')
  const [confirm, setConfirm] = useState('')
  const go = async () => {
    if (secret !== confirm) { toast(t('Password/PIN values do not match')); return }
    try {
      const updated = user.hasPassword
        ? await passwordChange(current, secret)
        : await passwordSetWithPasskey(secret)
      setUser(updated); close(); toast(user.hasPassword ? t('Password/PIN changed') : t('Password/PIN enabled'))
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Could not update password/PIN')) }
  }
  return <>
    <h3>{user.hasPassword ? t('Change password or PIN') : t('Set password or PIN')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{user.hasPassword
      ? t('Confirm the current password/PIN, then choose the new one.')
      : t('Confirm once with your existing passkey, then use the same profile with username and password/PIN.')}</div>
    {user.hasPassword && <>
      <TextField type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} placeholder={t('Current password or PIN')} maxLength={128} />
      <div style={{ height: 10 }} />
    </>}
    <TextField type="password" autoComplete="new-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={t('New password or PIN')} maxLength={128} />
    <div style={{ height: 10 }} /><TextField type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={t('Repeat password or PIN')} maxLength={128} />
    <div className="dim small" style={{ marginTop: 6 }}>{t('Use at least 8 characters, or a numeric PIN of 6 to 12 digits.')}</div>
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Save')}</Button>
  </>
}

function AddPasskeySheet({ close, toast, setUser }) {
  const [label, setLabel] = useState('')
  const go = async () => {
    try {
      const { count, user } = await passkeyAdd(label.trim() || t('Another device'))
      if (user) setUser(user)
      close(); toast(t('Passkey added — {0} passkeys now protect this profile.', count))
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Could not add passkey')) }
  }
  return <>
    <h3>{t('Add another passkey')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Name the device, then choose this device or the QR/another-device option in the secure system dialog.')}</div>
    <TextField value={label} onChange={e => setLabel(e.target.value)} placeholder={t('Device name, e.g. Mobile')} maxLength={40} />
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

function RecoveryCodesSheet({ close, toast, user }) {
  const [codes, setCodes] = useState(null)
  const [secret, setSecret] = useState('')
  // A profile with no passkey proves itself with the password/PIN instead — otherwise the one
  // account shape that most needs recovery codes would be the one that cannot generate them.
  const bySecret = !user?.hasPasskey
  const generate = async () => {
    if (bySecret && !secret) { toast(t('Enter your password or PIN')); return }
    try { const result = await regenerateRecoveryCodes(bySecret ? secret : undefined); setCodes(result.codes) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Could not generate recovery codes')) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); toast(t('Recovery codes copied')) }
    catch { toast(t('Could not copy codes')) }
  }
  return <>
    <h3>{t('Recovery codes')}</h3>
    {!codes ? <>
      <div className="muted small" style={{ marginBottom: 14 }}>{bySecret
        ? t('Generating new codes invalidates any old ones. Confirm with your password or PIN, then store the new codes somewhere private.')
        : t('Generating new codes invalidates any old ones. Confirm with your passkey, then store the new codes somewhere private.')}</div>
      {bySecret && <>
        <TextField type="password" autoComplete="current-password" value={secret} onChange={e => setSecret(e.target.value)} placeholder={t('Password or PIN')} maxLength={128} onKeyDown={e => { if (e.key === 'Enter') generate() }} />
        <div style={{ height: 12 }} />
      </>}
      <Button variant="primary" onClick={generate}>{t('Generate recovery codes')}</Button>
    </> : <>
      <div className="small" style={{ marginBottom: 12 }}>{t('Save these now. They are shown only once and each code works once.')}</div>
      <pre className="card" style={{ userSelect: 'all', textAlign: 'center', lineHeight: 1.9, letterSpacing: '.08em' }}>{codes.join('\n')}</pre>
      <div className="row" style={{ gap: 8 }}><Button onClick={copy}>{t('Copy codes')}</Button><Button variant="primary" onClick={close}>{t('Done')}</Button></div>
    </>}
  </>
}
