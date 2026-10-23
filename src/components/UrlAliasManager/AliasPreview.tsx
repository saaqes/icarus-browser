import { useMessages } from '../../i18n';
import { normalizeAliasText, normalizeHostPattern, sampleUrlForRule } from '../../services/alias-rules';
import { normalizeUserUrl, splitUrlForDisplay } from '../../services/url-resolution/urlUtils';
import type { AliasRuleInput } from '../../types/alias';
import { Favicon } from '../common/Favicon';
import { Icon } from '../common/Icon';

/** Vista previa de cómo se verá la regla en la barra de direcciones y en la pestaña. */
export function AliasPreview({ draft }: { draft: AliasRuleInput }) {
  const m = useMessages();
  const t = m.aliasManager.preview;

  let sampleUrl: string | null = null;
  if (draft.matchType === 'host') {
    const host = normalizeHostPattern(draft.pattern);
    sampleUrl = host ? `https://${host.host}/` : null;
  } else {
    const normalized = normalizeUserUrl(draft.pattern);
    sampleUrl = normalized.ok ? sampleUrlForRule({ matchType: draft.matchType, pattern: normalized.url })?.href ?? null : null;
  }
  const alias = normalizeAliasText(draft.alias);
  const target = normalizeUserUrl(draft.targetUrl);

  if (!sampleUrl || !alias || !draft.displayName.trim()) {
    return (
      <section className="alias-preview" aria-label={t.title}>
        <h4>{t.title}</h4>
        <p className="field-hint">{t.incomplete}</p>
      </section>
    );
  }

  const display = splitUrlForDisplay(sampleUrl);
  return (
    <section className={`alias-preview${draft.enabled ? '' : ' is-inactive'}`} aria-label={t.title}>
      <h4>{t.title}</h4>
      <div className="alias-preview__mock">
        <span className="alias-preview__label">{t.tab}</span>
        <div className="alias-preview__tab">
          <Favicon url={sampleUrl} label={draft.displayName} size={14} />
          <span>{draft.displayName.trim()}</span>
        </div>
        <span className="alias-preview__label">{t.addressBar}</span>
        <div className="alias-preview__omnibox">
          <Icon name="tag" size={14} />
          <span className="alias-chip">{m.addressBar.aliasBadge}</span>
          <span className="omnibox__alias">{alias}</span>
          <span className="omnibox__real-host">{display.host}</span>
        </div>
      </div>
      <dl className="alias-preview__details">
        <div>
          <dt>{t.realUrl}</dt>
          <dd className="mono">{sampleUrl}</dd>
        </div>
        <div>
          <dt>{t.alias}</dt>
          <dd className="mono">{alias}</dd>
        </div>
        <div>
          <dt>{t.target}</dt>
          <dd className="mono">{target.ok ? target.url : '—'}</dd>
        </div>
      </dl>
      {!draft.enabled && (
        <p className="field-hint">
          <Icon name="info" size={14} />
          {t.inactive}
        </p>
      )}
    </section>
  );
}
