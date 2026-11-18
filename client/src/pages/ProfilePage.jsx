// Profile: name, app language, farm location (geolocation or city search).
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Languages, MapPin, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';
import { LANGUAGES } from '../lib/constants';
import LocationPicker from '../components/LocationPicker';
import { Button, Card, ErrorAlert, Field, inputClass, Notice, PageHeader } from '../components/ui';

export default function ProfilePage() {
  const { t, i18n } = useTranslation();
  const { user, updateProfile } = useAuth();
  const [params] = useSearchParams();
  const [name, setName] = useState(user.name);
  const [language, setLanguage] = useState(user.preferredLanguage);
  const [location, setLocation] = useState(user.location ?? null);
  const [state, setState] = useState({ busy: false, error: '', saved: false });

  const save = async (patch) => {
    setState({ busy: true, error: '', saved: false });
    try {
      await updateProfile(patch);
      setState({ busy: false, error: '', saved: true });
    } catch (err) {
      setState({ busy: false, error: errorMessage(err, t), saved: false });
    }
  };

  const onLocation = (loc) => {
    setLocation(loc);
    save({ location: loc }); // save right away: the most important setting for weather + advice
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title={t('profile.title')} />
      {params.get('welcome') && !user.location && <Notice tone="info" icon={MapPin}>{t('dashboard.setLocationHint')}</Notice>}

      <Card title={t('profile.location')} icon={MapPin}>
        <LocationPicker value={location} onChange={onLocation} />
        {location && (
          <Button variant="ghost" className="mt-2 text-sm" onClick={() => { setLocation(null); save({ location: null }); }}>{t('profile.clearLocation')}</Button>
        )}
      </Card>

      <Card title={t('profile.name')} icon={User}>
        <form onSubmit={(e) => { e.preventDefault(); save({ name: name.trim(), preferredLanguage: language }); }} className="space-y-4">
          <Field id="p-name" label={t('profile.name')}>
            <input id="p-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} minLength={2} required />
          </Field>
          <Field id="p-lang" label={t('profile.language')}>
            <div className="flex items-center gap-2">
              <Languages className="size-5 text-brand-700" aria-hidden />
              <select id="p-lang" className={inputClass} value={language} onChange={(e) => { setLanguage(e.target.value); i18n.changeLanguage(e.target.value); }}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
              </select>
            </div>
          </Field>
          <Button type="submit" loading={state.busy} disabled={name.trim().length < 2} className="w-full">{t('common.save')}</Button>
        </form>
      </Card>

      <ErrorAlert message={state.error} />
      {state.saved && <Notice tone="success" icon={CheckCircle2}>{t('profile.saved')}</Notice>}
      <p className="text-center text-sm text-ink-muted">{user.email || user.phone}</p>
    </div>
  );
}
