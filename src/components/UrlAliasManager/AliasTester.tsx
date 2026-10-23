import { useState } from 'react';
import { useMessages } from '../../i18n';
import { findAliasMatch } from '../../services/alias-rules';
import { parseWebUrl } from '../../services/url-resolution/urlUtils';
import type { AliasRule } from '../../types/alias';
import { Field } from '../common/Controls';
import { Icon } from '../common/Icon';

/** Comprueba qué regla se aplicaría a una URL real. */
export function AliasTester({ rules }: { rules: AliasRule[] }) {
  const m = useMessages();
  const t = m.aliasManager.tester;
  const [value, setValue] = useState('https://www.google.com/');
  const url = parseWebUrl(value);
  const match = url ? findAliasMatch(url.href, rules) : null;

  return (
    <section className="alias-tester" aria-label={t.title}>
      <h3>{t.title}</h3>
      <Field label={t.label}>
        {(props) => (
          <input {...props} className="input mono" value={value} placeholder={t.placeholder} spellCheck={false} onChange={(event) => setValue(event.target.value)} />
        )}
      </Field>
      <div className="alias-tester__result" role="status">
        {!url ? (
          <p className="field-hint">{t.invalid}</p>
        ) : match ? (
          <>
            <p>
              <Icon name="check" size={14} /> {t.match(match.rule.name)}
            </p>
            <p>
              {t.shownAs}{' '}
              <span className="alias-chip">
                <Icon name="tag" size={12} />
                {match.rule.alias}
              </span>{' '}
              · {match.rule.displayName}
            </p>
          </>
        ) : (
          <p>{t.noMatch}</p>
        )}
      </div>
      <p className="field-hint">{m.aliasManager.priorityNote}</p>
    </section>
  );
}
