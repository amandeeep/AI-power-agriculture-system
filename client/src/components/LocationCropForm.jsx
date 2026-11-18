// "From my field" mode of the crop page: pick a field (or the profile location) and a month, and the
// server builds the inputs from soil records, climate normals, crop history and nearby farms.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CloudSun, FlaskRound, History, MapPin, Sprout, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage } from '../lib/api';
import { intlLocale } from '../lib/constants';
import { placeName } from './LocationPicker';
import { Badge, Button, Card, ErrorAlert, Field, inputClass, Notice, Spinner } from './ui';

export const PROFILE = 'profile';

export function useMonthName() {
  const { i18n } = useTranslation();
  return (m) => new Intl.DateTimeFormat(intlLocale(i18n.resolvedLanguage), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1)));
}

/** Soil Health Card class shares for the district (latest year) + which years exist (past record). */
function ShcStatus({ district }) {
  const { t } = useTranslation();
  const rows = ['N', 'P', 'K'].filter((k) => district.status[k]);
  return (
    <div className="mt-2 rounded-xl bg-mint p-3 ring-1 ring-line">
      <p className="mb-1 text-xs font-semibold text-ink-soft">{t('crop.shcStatus', { district: district.district, year: district.year })}</p>
      <table className="w-full text-xs tabular-nums">
        <thead>
          <tr className="text-ink-muted">
            <th className="py-0.5 text-left font-medium"><span className="sr-only">{t('crop.soilFrom')}</span></th>
            <th className="py-0.5 text-right font-medium">{t('crop.low')}</th>
            <th className="py-0.5 text-right font-medium">{t('crop.medium')}</th>
            <th className="py-0.5 text-right font-medium">{t('crop.high')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k} className="border-t border-line">
              <th scope="row" className="py-0.5 text-left font-medium text-ink-soft">{t(`nutrients.${k}`, k)}</th>
              <td className="py-0.5 text-right text-ink">{district.status[k].low}%</td>
              <td className="py-0.5 text-right text-ink">{district.status[k].medium}%</td>
              <td className="py-0.5 text-right text-ink">{district.status[k].high}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      {district.history && Object.keys(district.history).length > 1 && (
        <p className="mt-1 text-xs text-ink-soft">{t('crop.shcYears', { years: Object.keys(district.history).join(', ') })}</p>
      )}
      <p className="mt-1 text-xs text-ink-muted">{t('crop.shcSource')}</p>
    </div>
  );
}

/** Soil / climate / history / nearby evidence behind a location-based result. */
export function LocationEvidence({ data }) {
  const { t, i18n } = useTranslation();
  const monthName = useMonthName();
  const fmtDate = (d) => new Intl.DateTimeFormat(intlLocale(i18n.resolvedLanguage), { dateStyle: 'medium' }).format(new Date(d));
  const { soil, climate, history, area } = data;
  const soilText = soil.source === 'field_tests'
    ? t('crop.soilSource.field_tests', { n: soil.testsUsed, date: fmtDate(soil.latestTestAt) })
    : soil.source === 'district_estimate'
      ? t('crop.soilSource.district_estimate', { district: [soil.district?.district, soil.district?.state].filter(Boolean).join(', '), samples: soil.district?.samples ?? '?' })
      : t('crop.soilSource.manual');

  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="flex items-center gap-2 font-semibold text-ink"><FlaskRound className="size-4 text-brand-700" aria-hidden />{t('crop.soilFrom')}</p>
        <p className="text-ink-soft">{soilText}</p>
        <p className="tabular-nums text-ink-soft">N {soil.values.N} · P {soil.values.P} · K {soil.values.K} · pH {soil.values.ph}</p>
        {soil.source === 'district_estimate' && soil.district?.status && <ShcStatus district={soil.district} />}
        {soil.source === 'district_estimate' && <div className="mt-2"><Notice tone="warning">{t('crop.districtCaution')}</Notice></div>}
      </div>
      <div>
        <p className="flex items-center gap-2 font-semibold text-ink"><CloudSun className="size-4 text-brand-700" aria-hidden />{t('crop.climateFrom')}</p>
        <p className="text-ink-soft">
          {climate.source === 'climate_normals'
            ? t('crop.climateSource.climate_normals', { month: monthName(climate.month), period: climate.period })
            : t('crop.climateSource.live_weather')}
        </p>
        <p className="tabular-nums text-ink-soft">{climate.temperature} °C · {climate.humidity} % · {climate.rainfall} mm</p>
      </div>
      {data.field && (
        <div>
          <p className="flex items-center gap-2 font-semibold text-ink"><History className="size-4 text-brand-700" aria-hidden />{t('crop.pastCrops')}</p>
          {history.length ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {history.map((h) => <Badge key={`${h.year}-${h.season}`}>{t(`crop.seasonNames.${h.season}`, h.season)} {h.year}: {t(`crops.${h.crop}`, h.crop)}</Badge>)}
            </div>
          ) : <p className="text-ink-soft">{t('crop.noPastCrops')}</p>}
        </div>
      )}
      <div>
        <p className="flex items-center gap-2 font-semibold text-ink"><Users className="size-4 text-brand-700" aria-hidden />{t('crop.area')}</p>
        <p className="text-ink-soft">{area.used ? t('crop.nearby', { n: area.records, km: area.radiusKm }) : t('crop.nearbyNone')}</p>
      </div>
    </div>
  );
}

export default function LocationCropForm({ initialField, onResult }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const monthName = useMonthName();
  const [fields, setFields] = useState(null);
  const [target, setTarget] = useState(initialField ?? '');
  const [month, setMonth] = useState('');
  const [state, setState] = useState({ loading: false, error: '' });

  useEffect(() => {
    api.get('/fields')
      .then(({ data }) => {
        setFields(data.items);
        setTarget((cur) => cur || data.items[0]?.id || (user?.location ? PROFILE : ''));
      })
      .catch((err) => { setFields([]); setState({ loading: false, error: errorMessage(err, t) }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (!target) return;
    setState({ loading: true, error: '' });
    onResult(null);
    try {
      const body = target === PROFILE ? {} : { fieldId: target };
      if (month) body.month = Number(month);
      const { data } = await api.post('/recommend/location', body);
      setState({ loading: false, error: '' });
      onResult(data);
    } catch (err) {
      const code = err?.response?.data?.error?.details?.code;
      const msg = code === 'no_soil_data' ? t('crop.noSoilData') : code === 'no_location' ? t('crop.noLocationErr') : errorMessage(err, t);
      setState({ loading: false, error: msg });
    }
  };

  if (fields === null) return <Spinner label={t('common.loading')} />;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card title={t('crop.fieldLabel')} icon={MapPin}>
        <p className="mb-3 text-sm text-ink-soft">{t('crop.locationSubtitle')}</p>
        {!fields.length && (
          <div className="mb-3">
            <Notice>{t('crop.noFields')} <Link to="/fields" className="font-semibold underline">{t('crop.addFieldLink')}</Link></Notice>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field id="loc-field" label={t('crop.fieldLabel')}>
            <select id="loc-field" className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)}>
              {!target && <option value="">-</option>}
              {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              {user?.location && <option value={PROFILE}>{t('crop.profileLocation', { place: placeName(user.location) })}</option>}
            </select>
          </Field>
          <Field id="loc-month" label={t('crop.month')} optional optionalLabel={t('common.optional')}>
            <select id="loc-month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">{t('crop.currentMonth')}</option>
              {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
            </select>
          </Field>
        </div>
      </Card>
      <ErrorAlert message={state.error} />
      <Button type="submit" loading={state.loading} disabled={!target} className="w-full"><Sprout className="size-5" aria-hidden />{t('crop.submit')}</Button>
    </form>
  );
}
