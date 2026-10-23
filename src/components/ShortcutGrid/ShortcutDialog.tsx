import { useState } from 'react';
import { useMessages } from '../../i18n';
import type { ShortcutErrors } from '../../services/shortcuts/shortcuts';
import type { Shortcut, ShortcutInput } from '../../types/shortcuts';
import { Field } from '../common/Controls';
import { Modal } from '../common/Modal';

interface ShortcutDialogProps {
  open: boolean;
  shortcut: Shortcut | null;
  onClose: () => void;
  /** Devuelve los errores de validación o null si se guardó. */
  onSave: (input: ShortcutInput) => ShortcutErrors | null;
}

/** Diálogo para añadir o editar un acceso directo, con validación de la dirección. */
export function ShortcutDialog({ open, shortcut, onClose, onSave }: ShortcutDialogProps) {
  const m = useMessages();
  const [title, setTitle] = useState(shortcut?.title ?? '');
  const [url, setUrl] = useState(shortcut?.url ?? '');
  const [errors, setErrors] = useState<ShortcutErrors>({});

  const submit = () => {
    const result = onSave({ title, url });
    if (result) setErrors(result);
  };

  return (
    <Modal
      open={open}
      title={shortcut ? m.shortcuts.edit : m.shortcuts.add}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            {m.common.cancel}
          </button>
          <button type="submit" form="shortcut-form" className="btn btn--primary">
            {m.common.save}
          </button>
        </>
      }
    >
      <form
        id="shortcut-form"
        className="form-stack"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={m.shortcuts.name} error={errors.title ? m.shortcuts.errors[errors.title] : null}>
          {(props) => (
            <input
              {...props}
              className="input"
              value={title}
              maxLength={60}
              placeholder={m.shortcuts.namePlaceholder}
              data-autofocus
              onChange={(event) => setTitle(event.target.value)}
            />
          )}
        </Field>
        <Field label={m.shortcuts.url} error={errors.url ? m.shortcuts.errors[errors.url] : null}>
          {(props) => (
            <input
              {...props}
              className="input mono"
              value={url}
              inputMode="url"
              spellCheck={false}
              autoCapitalize="off"
              placeholder={m.shortcuts.urlPlaceholder}
              onChange={(event) => setUrl(event.target.value)}
            />
          )}
        </Field>
      </form>
    </Modal>
  );
}
