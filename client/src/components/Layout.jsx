// App shell: dark green top bar (logo, links, language, account menu) + bottom tab bar on phones.
import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bug, FlaskConical, History, Home, Languages, LogOut, MapPin, MessageCircle, Sprout, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { LANGUAGES } from '../lib/constants';
import { LogoMark, Spinner } from './ui';

// desktop: shown in the top bar (md+); mobile: shown in the 5-slot bottom tab bar.
const MAIN_LINKS = [
  { to: '/', key: 'home', icon: Home, end: true, desktop: true, mobile: true },
  { to: '/chat', key: 'chat', icon: MessageCircle, desktop: true, mobile: true },
  { to: '/crop', key: 'crop', icon: Sprout, desktop: true, mobile: true },
  { to: '/fertilizer', key: 'fertilizer', icon: FlaskConical, desktop: true, mobile: false },
  { to: '/disease', key: 'disease', icon: Bug, desktop: true, mobile: true },
  { to: '/fields', key: 'fields', icon: MapPin, desktop: true, mobile: true },
];

/** Language picker. tone "dark" sits on the green app bar, "light" on white pages (landing, auth). */
export function LanguageSwitcher({ tone = 'dark' }) {
  const { t, i18n } = useTranslation();
  const { user, updateProfile } = useAuth();
  const change = (lng) => {
    i18n.changeLanguage(lng);
    // Keep the saved preference in sync, so chat answers come back in the same language.
    if (user && user.preferredLanguage !== lng) updateProfile({ preferredLanguage: lng }).catch(() => {});
  };
  const dark = tone === 'dark';
  return (
    <label className={`flex min-h-11 items-center gap-1.5 rounded-xl px-2 ${dark ? 'ring-1 ring-white/35' : 'bg-white ring-1 ring-line-strong'}`}>
      <Languages className={`size-5 shrink-0 ${dark ? 'text-brand-100' : 'text-brand-800'}`} aria-hidden />
      <span className="sr-only">{t('nav.language')}</span>
      <select
        value={i18n.resolvedLanguage}
        onChange={(e) => change(e.target.value)}
        className={`min-h-10 max-w-28 cursor-pointer appearance-none border-0 bg-transparent pr-1 font-semibold focus:outline-none ${dark ? 'text-white' : 'text-ink'}`}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="text-ink">{l.native}</option>
        ))}
      </select>
    </label>
  );
}

function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onClick = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onClick); document.removeEventListener('keydown', onKey); };
  }, []);

  const initial = (user?.name ?? '?').trim().charAt(0).toUpperCase();
  const item = 'flex min-h-12 w-full items-center gap-3 px-4 text-left text-ink hover:bg-brand-50';
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid size-11 place-items-center rounded-full bg-amber-300 font-display text-lg font-extrabold text-amber-950 ring-2 ring-transparent hover:ring-white/60 focus-visible:outline-3 focus-visible:outline-white"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('nav.menu')}
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-white py-1 shadow-xl">
          {user?.name && <p className="truncate px-4 pb-2 pt-3 text-sm font-semibold text-ink-muted">{user.name}</p>}
          <NavLink role="menuitem" to="/fertilizer" className={`${item} md:hidden`}><FlaskConical className="size-5 text-brand-700" />{t('nav.fertilizer')}</NavLink>
          <NavLink role="menuitem" to="/history" className={item}><History className="size-5 text-brand-700" />{t('nav.history')}</NavLink>
          <NavLink role="menuitem" to="/profile" className={item}><User className="size-5 text-brand-700" />{t('nav.profile')}</NavLink>
          <button role="menuitem" onClick={logout} className={`${item} border-t border-line text-red-700`}>
            <LogOut className="size-5" />{t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const fullHeight = pathname.startsWith('/chat'); // chat manages its own scrolling

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:font-semibold focus:text-brand-900">
        {t('nav.skip', 'Skip to content')}
      </a>
      <header className="sticky top-0 z-20 bg-brand-900 text-white">
        <nav aria-label={t('nav.main', 'Main')} className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-3 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2.5 rounded-lg">
            <LogoMark className="size-9" inverse />
            <span className="hidden font-display text-lg font-extrabold min-[400px]:inline">{t('app.name')}</span>
          </NavLink>
          <div className="ml-4 hidden items-center gap-1 md:flex">
            {MAIN_LINKS.filter((l) => l.desktop).map(({ to, key, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) => `flex min-h-11 items-center rounded-xl px-3 font-medium lg:px-3.5 ${isActive ? 'bg-white/15 font-semibold text-white' : 'text-brand-50/90 hover:bg-white/10'}`}
              >
                {t(`nav.${key}`)}
              </NavLink>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </nav>
      </header>

      <main id="main" className={`mx-auto w-full max-w-7xl flex-1 ${fullHeight ? 'flex flex-col' : 'px-4 pb-28 pt-5 sm:px-6 md:pb-10 md:pt-7'}`}>
        <Suspense fallback={<Spinner label={t('common.loading')} />}>
          <Outlet />
        </Suspense>
      </main>

      {/* Bottom tab bar: phones only */}
      <nav aria-label={t('nav.main', 'Main')} className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid grid-cols-5">
          {MAIN_LINKS.filter((l) => l.mobile).map(({ to, key, icon: Icon, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-0.5 text-[11px] leading-tight ${isActive ? 'font-bold text-brand-900' : 'font-medium text-ink-soft'}`}
              >
                {({ isActive }) => (
                  <>
                    <span className={`grid h-8 w-12 place-items-center rounded-full ${isActive ? 'bg-brand-100' : ''}`}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span className="max-w-full truncate px-0.5">{t(`nav.${key}`)}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
