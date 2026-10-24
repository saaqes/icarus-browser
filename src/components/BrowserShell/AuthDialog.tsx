/** Diálogo de autenticación HTTP (Basic, Digest, NTLM…) de la pestaña activa. */

import { useState } from 'react';
import { useMessages } from '../../i18n';
import type { AuthRequestInfo } from '../../types/native';
import { Field } from '../common/Controls';
import { Icon } from '../common/Icon';
import { Modal } from '../common/Modal';
import { useBrowser } from './BrowserContext';

function AuthForm({ request }: { request: AuthRequestInfo }) {
  const m = useMessages();
  const t = m.auth;
  const { respondAuth } = useBrowser();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const formId = `auth-${request.id}`;
  const cancel = () => respondAuth(request.id, null);
  return (
    <Modal
      open
      title={t.title}
      onClose={cancel}
      size="sm"
      description={request.isProxy ? t.proxy(request.origin) : t.site(request.origin)}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={cancel}>
            {m.common.cancel}
          </button>
          <button type="submit" form={formId} className="btn btn--primary">
            {t.submit}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          respondAuth(request.id, { username, password });
        }}
      >
        {request.realm && (
          <p className="auth-form__realm">
            <span className="field-label">{t.realm}</span>
            <span className="selectable">«{request.realm}»</span>
          </p>
        )}
        {!request.secure && (
          <p className="info-box info-box--warning">
            <Icon name="warning" size={16} />
            {t.insecure}
          </p>
        )}
        <Field label={t.username}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="text"
              autoComplete="username"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              data-autofocus
            />
          )}
        </Field>
        <Field label={t.password}>
          {(props) => (
            <input {...props} className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          )}
        </Field>
        <p className="field-hint">{t.note}</p>
      </form>
    </Modal>
  );
}

export function AuthDialog() {
  const { authRequests, activeTab } = useBrowser();
  const request = authRequests.find((item) => item.tabId === activeTab.id);
  // La clave reinicia el formulario si llega otra solicitud (p. ej. tras una contraseña incorrecta).
  return request ? <AuthForm key={request.id} request={request} /> : null;
}
