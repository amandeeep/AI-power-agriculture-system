// Login and Register screens (shown without the app shell).
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import { errorMessage, fieldErrors } from '../lib/api';
import { LANGUAGES } from '../lib/constants';
import { LanguageSwitcher } from '../components/Layout';
import { Button, ErrorAlert, Field, inputClass, LogoMark } from '../components/ui';

function AuthShell({ title, subtitle, children }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh bg-mint">
      {/* Photo panel: wide screens only */}
      <aside className="relative hidden w-[44%] max-w-2xl overflow-hidden lg:block">
        <img
          src="/images/terraces-sikkim-1600.jpg"
          srcSet="/images/terraces-sikkim-800.jpg 800w, /images/terraces-sikkim-1600.jpg 1600w"
          sizes="44vw"
          alt=""
          className="absolute inset-0 size-full object-cover"
        />
        <div className="absolute inset-0 bg-brand-950/60" />
        <div className="relative flex h-full flex-col justify-end gap-3 p-10 text-white">
          <p className="max-w-md font-display text-3xl font-extrabold leading-tight">{t('landing.hero.title')}</p>
          <p className="max-w-md text-brand-50">{t('app.tagline')}</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 p-4">
          <Link to="/welcome" className="flex items-center gap-2.5 rounded-lg">
            <LogoMark className="size-10" />
            <span className="font-display text-xl font-extrabold text-ink">{t('app.name')}</span>
          </Link>
          <LanguageSwitcher tone="light" />
        </div>
        <div className="mx-auto w-full max-w-md flex-1 px-4 pb-10 pt-4 sm:pt-10">
          <div className="rounded-3xl border border-line bg-white p-5 sm:p-7">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
            <p className="mb-5 mt-1 text-ink-soft">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(form.identifier.trim(), form.password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title={t('auth.loginTitle')} subtitle={t('auth.loginSubtitle')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="identifier" label={t('auth.identifier')}>
          <input id="identifier" className={inputClass} autoComplete="username" required value={form.identifier}
            onChange={(e) => setForm({ ...form, identifier: e.target.value })} />
        </Field>
        <Field id="password" label={t('auth.password')}>
          <input id="password" type="password" className={inputClass} autoComplete="current-password" required value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        <ErrorAlert message={error} />
        <Button type="submit" loading={busy} className="w-full" disabled={!form.identifier || !form.password}>{t('auth.loginButton')}</Button>
      </form>
      <p className="mt-4 text-center text-ink-soft">
        {t('auth.noAccount')} <Link to="/register" className="font-semibold text-brand-700 underline">{t('auth.goRegister')}</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', preferredLanguage: i18n.resolvedLanguage || 'en' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const validate = () => {
    const v = {};
    if (form.name.trim().length < 2) v.name = t('common.required');
    if (!form.email.trim() && !form.phone.trim()) v.email = t('auth.contactHint');
    if (form.password.length < 6) v.password = t('auth.passwordHint');
    return v;
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validate();
    setErrors(v);
    if (Object.keys(v).length) return;
    setError('');
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), password: form.password, preferredLanguage: form.preferredLanguage };
      if (form.email.trim()) payload.email = form.email.trim();
      if (form.phone.trim()) payload.phone = form.phone.replace(/[\s-]/g, '');
      await register(payload);
      navigate('/profile?welcome=1', { replace: true }); // next step: set the farm location
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const input = (k, props = {}) => (
    <input id={k} className={inputClass} value={form[k]} onChange={set(k)} aria-invalid={Boolean(errors[k])} {...props} />
  );

  return (
    <AuthShell title={t('auth.registerTitle')} subtitle={t('auth.registerSubtitle')}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field id="name" label={t('auth.name')} error={errors.name}>{input('name', { autoComplete: 'name' })}</Field>
        <Field id="phone" label={t('auth.phone')} error={errors.phone} hint={t('auth.contactHint')}>{input('phone', { type: 'tel', inputMode: 'tel', autoComplete: 'tel' })}</Field>
        <Field id="email" label={t('auth.email')} error={errors.email}>{input('email', { type: 'email', autoComplete: 'email' })}</Field>
        <Field id="password" label={t('auth.password')} error={errors.password} hint={t('auth.passwordHint')}>{input('password', { type: 'password', autoComplete: 'new-password' })}</Field>
        <Field id="preferredLanguage" label={t('auth.language')}>
          <select id="preferredLanguage" className={inputClass} value={form.preferredLanguage}
            onChange={(e) => { set('preferredLanguage')(e); i18n.changeLanguage(e.target.value); }}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.native}</option>)}
          </select>
        </Field>
        <ErrorAlert message={error} />
        <Button type="submit" loading={busy} className="w-full">{t('auth.registerButton')}</Button>
      </form>
      <p className="mt-4 text-center text-ink-soft">
        {t('auth.haveAccount')} <Link to="/login" className="font-semibold text-brand-700 underline">{t('auth.goLogin')}</Link>
      </p>
    </AuthShell>
  );
}
