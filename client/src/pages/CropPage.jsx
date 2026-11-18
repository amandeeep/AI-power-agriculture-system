// Crop recommendation. Two modes:
//   "From my field": POST /api/recommend/location (soil records, climate normals, rotation, nearby farms)
//   "Enter soil test": POST /api/predict/crop with the values typed in.
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CloudSun, FlaskRound, ListChecks, Sprout } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { intlLocale } from '../lib/constants';
import NumberField, { rangeError } from '../components/NumberField';
import CropResults from '../components/results/CropResults';
import LocationCropForm, { LocationEvidence } from '../components/LocationCropForm';
import { placeName } from '../components/LocationPicker';
import { Button, Card, ErrorAlert, Field, inputClass, Notice, PageHeader } from '../components/ui';

const SOIL = ['N', 'P', 'K', 'ph'];
const CLIMATE = ['temperature', 'humidity', 'rainfall'];

export default function CropPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [mode, setMode] = useState(params.get('mode') === 'manual' ? 'manual' : 'location');
  const [form, setForm] = useState({ N: '', P: '', K: '', ph: '', temperature: '', humidity: '', rainfall: '', month: '' });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ loading: false, error: '', result: null });
  const [weatherState, setWeatherState] = useState({ loading: false, note: '' });
  const resultRef = useRef(null);

  const onChange = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => ({ ...e, [name]: '' }));
  };

  const fillWeather = async () => {
    if (!user?.location) return setWeatherState({ loading: false, note: t('crop.needLocation') });
    setWeatherState({ loading: true, note: '' });
    try {
      const { data } = await api.get('/weather', { params: { lat: user.location.lat, lon: user.location.lon } });
      setForm((f) => ({
        ...f,
        temperature: String(Math.round(data.current.temperature * 10) / 10),
        humidity: String(data.current.humidity),
        rainfall: String(data.summary.rainfallMonthlyEstimate),
      }));
      setErrors((e) => ({ ...e, temperature: '', humidity: '', rainfall: '' }));
      setWeatherState({ loading: false, note: t('crop.weatherFilled', { place: placeName(user.location) }) });
    } catch (err) {
      setWeatherState({ loading: false, note: errorMessage(err, t) });
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries([...SOIL, ...CLIMATE].map((k) => [k, rangeError(k, form[k], t)]).filter(([, m]) => m));
    setErrors(v);
    if (Object.keys(v).length) return;
    setState({ loading: true, error: '', result: null });
    try {
      const body = Object.fromEntries([...SOIL, ...CLIMATE].map((k) => [k, Number(form[k])]));
      if (form.month) body.month = Number(form.month);
      const { data } = await api.post('/predict/crop', body);
      setState({ loading: false, error: '', result: data });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      setErrors(fieldErrors(err));
      setState({ loading: false, error: errorMessage(err, t), result: null });
    }
  };

  const monthName = (m) => new Intl.DateTimeFormat(intlLocale(i18n.resolvedLanguage), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m - 1, 1)));

  const showResult = (data) => {
    setState({ loading: false, error: '', result: data });
    if (data) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const switchMode = (m) => { setMode(m); setState({ loading: false, error: '', result: null }); };
  const tab = (m) => `min-h-11 flex-1 rounded-lg px-3 font-semibold ${mode === m ? 'bg-white text-brand-800 shadow-sm' : 'text-ink-soft hover:bg-white/60'}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div>
        <PageHeader title={t('crop.title')} subtitle={mode === 'manual' ? t('crop.subtitle') : null} />
        <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label={t('crop.title')}>
          <button type="button" role="tab" aria-selected={mode === 'location'} className={tab('location')} onClick={() => switchMode('location')}>{t('crop.modeLocation')}</button>
          <button type="button" role="tab" aria-selected={mode === 'manual'} className={tab('manual')} onClick={() => switchMode('manual')}>{t('crop.modeManual')}</button>
        </div>
        {mode === 'location' && (
          <LocationCropForm initialField={params.get('field') ?? undefined} onResult={showResult} />
        )}
        {mode === 'manual' && (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Card title={t('crop.soil')} icon={FlaskRound}>
            <div className="grid grid-cols-2 gap-3">
              {SOIL.map((k) => <NumberField key={k} name={k} label={t(`crop.${k}`)} value={form[k]} onChange={onChange} error={errors[k]} />)}
            </div>
          </Card>
          <Card title={t('crop.climate')} icon={CloudSun}
            action={<Button type="button" variant="ghost" onClick={fillWeather} loading={weatherState.loading} className="text-sm">{t('crop.fillWeather')}</Button>}>
            {weatherState.note && <div className="mb-3"><Notice>{weatherState.note}</Notice></div>}
            <div className="grid grid-cols-2 gap-3">
              {CLIMATE.map((k) => <NumberField key={k} name={k} label={t(`crop.${k}`)} value={form[k]} onChange={onChange} error={errors[k]} />)}
              <Field id="f-month" label={t('crop.month')} optional optionalLabel={t('common.optional')}>
                <select id="f-month" className={inputClass} value={form.month} onChange={(e) => onChange('month', e.target.value)}>
                  <option value="">{t('crop.currentMonth')}</option>
                  {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{monthName(i + 1)}</option>)}
                </select>
              </Field>
            </div>
          </Card>
          <ErrorAlert message={state.error} />
          <Button type="submit" loading={state.loading} className="w-full"><Sprout className="size-5" aria-hidden />{t('crop.submit')}</Button>
        </form>
        )}
      </div>

      <div ref={resultRef} className="scroll-mt-20 lg:sticky lg:top-20">
        {state.result && (
          <div className="space-y-4">
            <Card title={state.result.field ? `${t('crop.resultsTitle')}: ${state.result.field.name}` : t('crop.resultsTitle')} icon={Sprout}>
              <CropResults data={state.result} />
            </Card>
            {state.result.soil && <Card title={t('crop.evidence')} icon={ListChecks}><LocationEvidence data={state.result} /></Card>}
          </div>
        )}
      </div>
    </div>
  );
}
