/** Configuración → Perfil: nombre, foto y color del círculo del perfil de la barra. */

import { useRef, useState } from 'react';
import { useSettings } from '../../../hooks/useStores';
import { useMessages } from '../../../i18n';
import { prepareProfilePhoto } from '../../../services/settings/profilePhoto';
import { updateProfile } from '../../../services/settings/settings';
import { PROFILE_COLORS, PROFILE_NAME_MAX } from '../../../types/settings';
import { Field } from '../../common/Controls';
import { Icon } from '../../common/Icon';
import { useToast } from '../../common/Toast';
import { ProfileAvatar } from '../../Profile/ProfileAvatar';
import { SettingsCard } from '../SettingsPage';
import '../../Customize/AppearanceControls.css';
import '../../Profile/Profile.css';

export function ProfileSection() {
  const m = useMessages();
  const t = m.profile;
  const notify = useToast();
  const [settings, updateSettings] = useSettings();
  const profile = settings.profile;
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const choosePhoto = async (file: File | undefined) => {
    if (!file) return;
    const photo = await prepareProfilePhoto(file);
    if (!photo) {
      setPhotoError(t.photoError);
      return;
    }
    setPhotoError(null);
    updateSettings((current) => updateProfile(current, { photo }));
    notify('success', t.photoSaved);
  };

  return (
    <>
      <SettingsCard title={t.preview}>
        <div className="profile-preview">
          <ProfileAvatar profile={profile} size={72} />
          <div>
            <p className="profile-panel__name">{profile.name.trim() || t.defaultName}</p>
            <p className="profile-panel__note">{t.local}</p>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title={t.name}>
        <Field label={t.name} hint={t.nameHint}>
          {(props) => (
            <input
              {...props}
              className="input"
              type="text"
              maxLength={PROFILE_NAME_MAX}
              placeholder={t.namePlaceholder}
              value={profile.name}
              onChange={(event) => {
                const name = event.target.value;
                updateSettings((current) => updateProfile(current, { name }));
              }}
            />
          )}
        </Field>
      </SettingsCard>

      <SettingsCard title={t.photo} description={t.photoHint}>
        <div className="profile-photo-actions">
          <button type="button" className="btn btn--ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="camera" size={16} />
            {t.choosePhoto}
          </button>
          {profile.photo && (
            <button type="button" className="btn btn--subtle" onClick={() => updateSettings((current) => updateProfile(current, { photo: null }))}>
              <Icon name="trash" size={16} />
              {t.removePhoto}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            hidden
            aria-label={t.choosePhoto}
            data-testid="profile-photo-input"
            onChange={(event) => {
              void choosePhoto(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        {photoError && (
          <p className="field-error" role="alert">
            <Icon name="warning" size={14} />
            {photoError}
          </p>
        )}
      </SettingsCard>

      <SettingsCard title={t.color} description={t.colorHint}>
        <fieldset className="swatches">
          <legend className="visually-hidden">{t.color}</legend>
          <div className="swatches__row">
            {PROFILE_COLORS.map((color, index) => (
              <label key={color} className={`swatch${profile.color === color ? ' is-selected' : ''}`} title={t.colorOption(index + 1)}>
                <input
                  type="radio"
                  name="profile-color"
                  value={color}
                  checked={profile.color === color}
                  aria-label={t.colorOption(index + 1)}
                  onChange={() => updateSettings((current) => updateProfile(current, { color }))}
                />
                <span className="swatch__color" style={{ background: color }} />
              </label>
            ))}
          </div>
        </fieldset>
      </SettingsCard>
    </>
  );
}
