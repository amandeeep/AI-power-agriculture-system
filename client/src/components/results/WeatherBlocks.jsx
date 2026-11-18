// Weather pieces used by the dashboard and the chat's weather tool card.
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, CloudRain, Droplets, Info, MapPin, Wind } from 'lucide-react';
import { intlLocale, weatherKey } from '../../lib/constants';
import WeatherIcon from '../WeatherIcon';
import { Notice } from '../ui';

export function useDayFormat() {
  const { i18n } = useTranslation();
  const loc = intlLocale(i18n.resolvedLanguage);
  return {
    weekday: (iso) => new Intl.DateTimeFormat(loc, { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)),
    dayMonth: (iso) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`)),
  };
}

export function CurrentWeather({ weather }) {
  const { t } = useTranslation();
  const c = weather.current;
  return (
    <div>
      {weather.location?.name && (
        <p className="mb-2 flex items-center gap-1 text-sm text-ink-muted"><MapPin className="size-4" aria-hidden />{weather.location.name}</p>
      )}
      <div className="flex items-center gap-4">
        <WeatherIcon code={c.weatherCode} className="size-14 text-amber-500" />
        <div>
          <p className="text-4xl font-bold tabular-nums text-ink">{Math.round(c.temperature)}°C</p>
          <p className="text-ink-soft">{t(`weatherCodes.${weatherKey(c.weatherCode)}`)}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat icon={Droplets} label={t('dashboard.humidity')} value={`${c.humidity}%`} />
        <Stat icon={Wind} label={t('dashboard.wind')} value={`${Math.round(c.windSpeed)} km/h`} />
        <Stat icon={CloudRain} label={t('dashboard.rain7d')} value={`${weather.summary.rainfall7d} mm`} />
        {weather.summary.rainfallPast30d != null && <Stat icon={CloudRain} label={t('dashboard.rain30d')} value={`${weather.summary.rainfallPast30d} mm`} />}
      </dl>
    </div>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-mint p-2">
      <dt className="flex items-center gap-1 text-ink-muted"><Icon className="size-4" aria-hidden />{label}</dt>
      <dd className="font-bold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export function ForecastStrip({ daily }) {
  const { t } = useTranslation();
  const { weekday } = useDayFormat();
  return (
    <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
      {daily.map((d, i) => (
        <li key={d.date} className="min-w-[4.75rem] flex-1 snap-start rounded-xl bg-mint p-2 text-center">
          <p className="text-sm font-semibold text-ink-soft">{i === 0 ? t('common.today') : weekday(d.date)}</p>
          <WeatherIcon code={d.weatherCode} className="mx-auto my-1 size-7 text-sky-600" />
          <p className="text-sm tabular-nums"><b className="text-ink">{Math.round(d.tMax)}°</b> <span className="text-ink-muted">{Math.round(d.tMin)}°</span></p>
          <p className="text-xs tabular-nums text-sky-700">{d.precipitation} mm</p>
        </li>
      ))}
    </ul>
  );
}

const ALERT_TONE = { danger: 'danger', warning: 'warning', info: 'info' };

export function AlertList({ alerts }) {
  const { t } = useTranslation();
  const { dayMonth } = useDayFormat();
  if (!alerts?.length) return <Notice tone="success" icon={CheckCircle2}>{t('dashboard.noAlerts')}</Notice>;
  return (
    <ul className="space-y-2">
      {alerts.map((a, i) => (
        <li key={`${a.code}-${a.date ?? i}`}>
          <Notice tone={ALERT_TONE[a.severity] ?? 'info'} icon={a.severity === 'info' ? Info : AlertTriangle}>
            {t(`alerts.${a.code}`, { date: a.date ? dayMonth(a.date) : '', value: a.value ?? '' })}
          </Notice>
        </li>
      ))}
    </ul>
  );
}
