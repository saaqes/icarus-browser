import { useNative, useUpdateState } from '../../../hooks/useNative';
import { useMessages } from '../../../i18n';
import { formatBytes } from '../../../services/format';
import type { UpdateState } from '../../../types/native';
import { IcarusMark } from '../../common/IcarusLogo';
import { Icon } from '../../common/Icon';
import { RadioList } from '../../common/Controls';
import { isUpdateInProgress, KeychainNotice, UpdateButtons, UpdateStatus, useUpdateActions, type UpdateActions } from '../../Updates/UpdateControls';
import { SettingsCard } from '../SettingsPage';

export function UpdatesSection() {
  const native = useNative();
  const state = useUpdateState();
  const actions = useUpdateActions();
  if (!native || !state || !actions) return null;
  return <UpdatesView state={state} platform={native.platform} actions={actions} />;
}

/** Contenido de la sección (separado para probar cada estado). */
export function UpdatesView({ state, platform, actions }: { state: UpdateState; platform: string; actions: UpdateActions }) {
  const m = useMessages();
  const t = m.updates;
  const formatDate = (iso: string, withTime = true) =>
    new Date(iso).toLocaleString(m.locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    });
  const supported = state.mode !== 'unsupported';
  const locked = isUpdateInProgress(state) || state.status === 'checking';
  const available = state.available;
  const how =
    state.mode === 'automatic'
      ? platform === 'darwin'
        ? t.how.automaticMac
        : t.how.automaticWindows
      : state.mode === 'manual-portable'
        ? t.how.manualPortable
        : state.mode === 'manual-dmg'
          ? t.how.manualDmg
          : state.mode === 'manual-release'
            ? t.how.manualRelease
            : state.unsupportedReason === 'no-key'
              ? t.how.noKey
              : t.how.development;

  return (
    <>
      {state.justUpdated && (
        <div className="update-banner" role="status">
          <Icon name="check" size={18} />
          <p>{t.justUpdated(state.justUpdated.from, state.justUpdated.to)}</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={actions.acknowledge}>
            {t.acknowledge}
          </button>
        </div>
      )}

      <SettingsCard title={t.installed}>
        <div className="update-summary">
          <IcarusMark size={48} tile />
          <div className="update-summary__text">
            <p className="update-summary__version">{t.version(state.currentVersion)}</p>
            <p className="update-summary__meta">
              {t.channelBadge(t.channels[state.channel])}
              {supported && ` · ${state.lastCheckedAt ? t.lastChecked(formatDate(state.lastCheckedAt)) : t.neverChecked}`}
            </p>
          </div>
          {supported && (
            <button type="button" className="btn btn--ghost btn--sm" disabled={locked} onClick={actions.check}>
              <Icon name="reload" size={14} />
              {t.check}
            </button>
          )}
        </div>
        {supported && <UpdateStatus state={state} />}
        {supported && <KeychainNotice state={state} />}
        {supported && (!available || isUpdateInProgress(state)) && <UpdateButtons state={state} actions={actions} />}
      </SettingsCard>

      {supported && available && (
        <SettingsCard
          title={t.newVersion(available.version)}
          description={[t.releasedOn(formatDate(available.releasedAt, false)), available.size ? t.size(formatBytes(available.size, m.locale)) : null]
            .filter(Boolean)
            .join(' · ')}
        >
          <div className="update-notes">{available.notes.trim() || t.noNotes}</div>
          {!isUpdateInProgress(state) && <UpdateButtons state={state} actions={actions} />}
          {available.version === state.postponedVersion && state.status === 'available' && <p className="field-hint">{t.postponed}</p>}
          {state.mode !== 'manual-release' && (
            <button type="button" className="link-btn" onClick={() => actions.openRelease(available.releasePage)}>
              {t.releasePage}
            </button>
          )}
        </SettingsCard>
      )}

      {supported && (
        <SettingsCard title={t.channel}>
          <RadioList
            label={t.channel}
            hideLabel
            value={state.channel}
            disabled={locked}
            options={(['stable', 'preview'] as const).map((value) => ({ value, label: t.channels[value], description: t.channelOptions[value] }))}
            onChange={actions.setChannel}
          />
          <p className="field-hint">{t.channelHint}</p>
        </SettingsCard>
      )}

      <SettingsCard title={t.howTitle}>
        <p>{how}</p>
        <p className="field-hint">{t.dataKept}</p>
      </SettingsCard>
    </>
  );
}
