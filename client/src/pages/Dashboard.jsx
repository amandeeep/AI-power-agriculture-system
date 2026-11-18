// Home: greeting, weather + 7-day forecast, farm alerts, quick actions, my fields and recent advice.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Camera, ChevronRight, CloudSun, FlaskConical, MapPin, MessageCircle, Plus, Sprout } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import useWeather from '../hooks/useWeather';
import { api } from '../lib/api';
import { intlLocale } from '../lib/constants';
import { AlertList, CurrentWeather, ForecastStrip } from '../components/results/WeatherBlocks';
import { placeName } from '../components/LocationPicker';
import { Button, Card, ErrorAlert, Spinner } from '../components/ui';

const TILES = [
  { to: '/chat', key: 'chat', icon: MessageCircle, primary: true },
  { to: '/crop', key: 'crop', icon: Sprout },
  { to: '/fertilizer', key: 'fertilizer', icon: FlaskConical, soil: true },
  { to: '/disease', key: 'disease', icon: Camera },
];

function useRelativeTime() {
  const { i18n } = useTranslation();
  const rtf = new Intl.RelativeTimeFormat(intlLocale(i18n.resolvedLanguage), { numeric: 'auto' });
  return (iso) => {
    const mins = Math.round((new Date(iso) - Date.now()) / 60000);
    if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
    const hours = Math.round(mins / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 7) return rtf.format(days, 'day');
    return rtf.format(Math.round(days / 7), 'week');
  };
}

/** One line per saved prediction, in the farmer's language. */
function useSummary() {
  const { t } = useTranslation();
  const crop = (c) => (c ? t(`crops.${String(c).toLowerCase()}`, c) : '');
  return (p) => {
    const o = p.output ?? {};
    if (p.type === 'crop' && o.top?.length) {
      return t('dashboard.recentCrop', { crop: crop(o.top[0].crop), pct: Math.round(o.top[0].final_score * 100) });
    }
    if (p.type === 'fertilizer') return t('dashboard.recentFertilizer', { crop: crop(o.crop ?? p.input?.crop) });
    if (p.type === 'disease') {
      return o.healthy ? t('dashboard.recentHealthy', { crop: o.crop ?? '' }) : t('dashboard.recentDisease', { crop: o.crop ?? '', disease: o.disease ?? '' });
    }
    return p.type;
  };
}

function MyFields() {
  const { t } = useTranslation();
  const [fields, setFields] = useState(null);
  useEffect(() => {
    api.get('/fields').then(({ data }) => setFields(data.items)).catch(() => setFields([]));
  }, []);

  return (
    <Card title={t('dashboard.myFields')} icon={MapPin} action={fields?.length ? <Link to="/fields" className="px-1 py-2.5 text-sm font-semibold text-brand-700 hover:text-brand-900">{t('dashboard.seeAll')}</Link> : null}>
      {fields === null ? <Spinner label={t('common.loading')} /> : fields.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-ink-soft">{t('dashboard.noFieldsYet')}</p>
          <Link to="/fields" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 font-bold text-white hover:bg-brand-800"><Plus className="size-5" aria-hidden />{t('dashboard.addField')}</Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {fields.slice(0, 3).map((f) => (
            <li key={f.id}>
              <Link to={`/crop?field=${f.id}`} className="flex items-center gap-3 rounded-2xl bg-mint p-3 hover:bg-brand-50">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-900"><Sprout className="size-6" aria-hidden /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-bold">{f.name}{f.areaAcres != null ? ` · ${t('dashboard.acres', { n: f.areaAcres })}` : ''}</span>
                  <span className="truncate text-sm text-ink-soft">{[f.village ?? f.city, f.district, f.state].filter(Boolean).join(', ') || t('fields.noLocation')}</span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-brand-700" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentAdvice() {
  const { t } = useTranslation();
  const ago = useRelativeTime();
  const summary = useSummary();
  const [items, setItems] = useState(null);
  useEffect(() => {
    api.get('/history', { params: { limit: 3 } }).then(({ data }) => setItems(data.items)).catch(() => setItems([]));
  }, []);

  return (
    <Card title={t('dashboard.recent')} action={items?.length ? <Link to="/history" className="px-1 py-2.5 text-sm font-semibold text-brand-700 hover:text-brand-900">{t('dashboard.seeAll')}</Link> : null}>
      {items === null ? <Spinner label={t('common.loading')} /> : items.length === 0 ? (
        <p className="text-ink-soft">{t('dashboard.noRecent')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-3 py-2.5">
              <span className="min-w-0">{summary(p)}</span>
              <span className="shrink-0 text-sm text-ink-muted">{ago(p.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const weather = useWeather(user?.location);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('dashboard.greeting', { name: user?.name?.split(' ')[0] ?? '' })}</h1>
          <p className="mt-1 text-ink-soft">{t('dashboard.subtitle')}</p>
        </div>
        {user?.location && (
          <Link to="/profile" className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-full border border-line bg-white px-3.5 text-sm font-semibold hover:border-brand-700">
            <MapPin className="size-4 shrink-0 text-brand-700" aria-hidden /><span className="truncate">{placeName(user.location)}</span>
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Left: weather */}
        <div className="flex min-w-0 flex-col gap-6 lg:flex-[1.6]">
          {!user?.location ? (
            <Card title={t('dashboard.setLocationTitle')} icon={MapPin}>
              <p className="mb-3 text-ink-soft">{t('dashboard.setLocationHint')}</p>
              <Link to="/profile"><Button className="w-full sm:w-auto"><MapPin className="size-5" aria-hidden />{t('nav.profile')}</Button></Link>
            </Card>
          ) : weather.loading && !weather.data ? (
            <Card><Spinner label={t('common.loading')} /></Card>
          ) : weather.error ? (
            <ErrorAlert message={weather.error} onRetry={weather.reload} retryLabel={t('common.retry')} />
          ) : weather.data ? (
            <>
              <Card title={t('dashboard.weatherNow')} icon={CloudSun}>
                <div className="flex flex-col gap-5">
                  <CurrentWeather weather={weather.data} />
                  <div>
                    <h3 className="mb-2 text-sm font-bold text-ink-soft">{t('dashboard.forecast')}</h3>
                    <ForecastStrip daily={weather.data.daily} />
                  </div>
                </div>
              </Card>
              <Card title={t('dashboard.alerts')} icon={AlertTriangle}><AlertList alerts={weather.data.alerts} /></Card>
            </>
          ) : null}
        </div>

        {/* Right: actions, fields, recent */}
        <div className="flex min-w-0 flex-col gap-6 lg:flex-1">
          <section aria-labelledby="qa-h" className="flex flex-col gap-3">
            <h2 id="qa-h" className="text-lg font-bold">{t('dashboard.quickActions')}</h2>
            <div className="grid grid-cols-2 gap-3">
              {TILES.map(({ to, key, icon: Icon, primary, soil }) => (
                <Link
                  key={to}
                  to={to}
                  className={`flex min-h-28 flex-col justify-between rounded-3xl p-4 transition hover:-translate-y-0.5 ${primary ? 'bg-brand-700 text-white hover:bg-brand-800' : 'border border-line bg-white hover:border-brand-700'}`}
                >
                  <Icon className={`size-7 ${primary ? '' : soil ? 'text-soil-500' : 'text-brand-700'}`} aria-hidden />
                  <span className="font-bold leading-snug">{t(`tiles.${key}`)}</span>
                </Link>
              ))}
            </div>
          </section>
          <MyFields />
          <RecentAdvice />
        </div>
      </div>
    </div>
  );
}
