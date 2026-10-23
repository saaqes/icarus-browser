import { useMessages } from '../../i18n';
import type { AliasConflict, AliasRule } from '../../types/alias';
import { Icon } from '../common/Icon';

/** Lista de conflictos entre reglas activas y qué regla se aplica en cada caso. */
export function AliasConflicts({ rules, conflicts }: { rules: AliasRule[]; conflicts: AliasConflict[] }) {
  const m = useMessages();
  const t = m.aliasManager.conflicts;
  const name = (id: string) => rules.find((rule) => rule.id === id)?.name ?? id;
  return (
    <section className={`alias-conflicts${conflicts.length ? ' has-conflicts' : ''}`} aria-label={t.title}>
      <h3>
        <Icon name={conflicts.length ? 'warning' : 'check'} size={14} />
        {t.title}
      </h3>
      {conflicts.length === 0 ? (
        <p className="field-hint">{t.none}</p>
      ) : (
        <ul>
          {conflicts.map((conflict, index) => (
            <li key={`${conflict.type}-${conflict.winnerId}-${conflict.loserId}-${index}`}>{t[conflict.type](name(conflict.winnerId), name(conflict.loserId))}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
