import { profileInitial } from '../../services/settings/settings';
import type { ProfileSettings } from '../../types/settings';
import { Icon } from '../common/Icon';

/** Círculo del perfil: la foto, la inicial del nombre sobre su color o la silueta. */
export function ProfileAvatar({ profile, size }: { profile: ProfileSettings; size: number }) {
  if (profile.photo) {
    return <img className="profile-avatar" src={profile.photo} alt="" width={size} height={size} draggable={false} data-testid="profile-photo" />;
  }
  const initial = profileInitial(profile);
  return (
    <span
      className="profile-avatar profile-avatar--initial"
      style={{ width: size, height: size, background: profile.color, fontSize: Math.round(size * 0.46) }}
      aria-hidden="true"
    >
      {initial ?? <Icon name="user" size={Math.round(size * 0.72)} />}
    </span>
  );
}
