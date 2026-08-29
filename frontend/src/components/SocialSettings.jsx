import { useEffect, useId, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { SOCIAL_FIELD_DEFAULTS, socialMe, saveSocialMe, purgeSocial } from '../lib/social-api.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button, Switch, TextArea, TextField } from './ui.jsx'

const fieldLabels = {
  exerciseNames: 'Exercise names', exactSets: 'Exact weights and reps', effort: 'RIR / RPE effort', volume: 'Total volume',
  bodyweight: 'Body weight', rating: 'Session rating', note: 'Session notes'
}

function Toggle({ label, detail, checked, onChange, disabled }) {
  const labelId = useId()
  return <div className="social-toggle"><div><div id={labelId}>{label}</div>{detail && <div className="small muted">{detail}</div>}</div><Switch checked={checked} disabled={disabled} onChange={onChange} aria-labelledby={labelId} /></div>
}

export default function SocialSettings() {
  const enabled = !!useStore(s => s.config)?.social?.enabled
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!enabled || !user) return
    socialMe().then(({ profile }) => setDraft({ ...profile, fields: { ...SOCIAL_FIELD_DEFAULTS, ...profile.fields }, notifications: { kudos: false, comments: false, challenges: false, ...profile.notifications } })).catch(e => toast(e.message))
  }, [enabled, user?.id])

  if (!enabled || !user) return null
  if (!draft) return <div className="card"><div className="muted small">{t('Loading social preferences…')}</div></div>

  const save = async () => {
    setBusy(true)
    try { const { profile } = await saveSocialMe(draft); setDraft({ ...draft, ...profile }); toast(t('Social preferences saved')) }
    catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  const purge = () => confirmSheet({
    title: t('Delete my publications?'),
    message: t('Your private workouts stay intact. Your published posts and the reactions and comments attached to them are deleted.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: async () => { try { const { profile } = await purgeSocial(); setDraft({ ...draft, ...profile }); toast(t('Publications deleted')) } catch (e) { toast(e.message) } }
  })

  return <section style={{ marginBottom: 24 }}>
    <h4 className="sect-t">{t('Social and privacy')}</h4>
    <div className="card">
      <div className="row" style={{ gap: 9, marginBottom: 14 }}><Icon name="personCircle" style={{ color: 'var(--acc)', fontSize: 24 }} /><div><b>{t('Private training group')}</b><div className="small muted">{t('Only invited members can see shared workouts. Imported and previous history stays private.')}</div></div></div>
      <label className="field-label" id="social-display-name-label">{t('Display name')}</label>
      <TextField aria-labelledby="social-display-name-label" maxLength={40} value={draft.displayName} onChange={e => setDraft(d => ({ ...d, displayName: e.target.value }))} />
      <label className="field-label">{t('Short bio')}</label>
      <TextArea rows={2} maxLength={120} value={draft.bio || ''} onChange={e => setDraft(d => ({ ...d, bio: e.target.value }))} />
      <div className="field-label">{t('Profile color')}</div>
      <div className="swatches">{Object.entries(ACCENTS).map(([key, color]) => <button key={key} aria-label={key} className={'swatch' + (draft.accent === key ? ' on' : '')} style={{ background: color }} onClick={() => setDraft(d => ({ ...d, accent: key }))} />)}</div>
      <Toggle label={t('Join weekly rankings')} detail={t('Ranking totals are calculated even when a workout is not posted.')} checked={draft.rankingsEnabled} onChange={rankingsEnabled => setDraft(d => ({ ...d, rankingsEnabled }))} />
      <Toggle label={t('Post workouts by default')} detail={t('You can change this for every workout before publishing.')} checked={draft.defaultPublish} onChange={defaultPublish => setDraft(d => ({ ...d, defaultPublish }))} />
      <h4 className="sec">{t('Default shared details')}</h4>
      {Object.keys(SOCIAL_FIELD_DEFAULTS).map(key => <Toggle key={key} label={t(fieldLabels[key])} checked={draft.fields[key]} disabled={(key === 'exactSets' || key === 'effort') && !draft.fields.exerciseNames}
        onChange={value => setDraft(d => ({ ...d, fields: { ...d.fields, [key]: value, ...(key === 'exerciseNames' && !value ? { exactSets: false, effort: false } : {}) } }))} />)}
      <h4 className="sec">{t('Social notifications')}</h4>
      {Object.entries({ kudos: 'Kudos', comments: 'Comments', challenges: 'Challenges' }).map(([key, label]) => <Toggle key={key} label={t(label)} checked={!!draft.notifications[key]} onChange={value => setDraft(d => ({ ...d, notifications: { ...d.notifications, [key]: value } }))} />)}
      <div className="row" style={{ gap: 8, marginTop: 14 }}><Button variant="primary" disabled={busy} onClick={save}>{t('Save')}</Button><Button variant="danger" disabled={busy} onClick={purge}>{t('Delete my publications')}</Button></div>
    </div>
  </section>
}
