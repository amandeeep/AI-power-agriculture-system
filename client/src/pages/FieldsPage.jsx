// My fields: each field's location, soil tests (with recency-weighted estimate + yearly trend) and
// crop history. These records feed the location-based crop recommendation (POST /api/recommend/location).
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDownRight, ArrowUpRight, FlaskRound, MapPin, Minus, Plus, Sprout, Tractor, Trash2, Wheat } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { CROPS, intlLocale, SEASONS } from '../lib/constants';
import LocationPicker, { AddressSummary, placeName } from '../components/LocationPicker';
import NumberField, { rangeError } from '../components/NumberField';
import { Badge, Button, Card, ErrorAlert, Field, inputClass, Notice, PageHeader, Spinner } from '../components/ui';

const SOIL = ['N', 'P', 'K', 'ph'];
const EMPTY_FIELD = { name: '', location: null, state: '', district: '', areaAcres: '' };
const today = () => new Date().toISOString().slice(0, 10);

function fieldPayload(f) {
  return {
    name: f.name.trim(),
    ...(f.location ? Object.fromEntries(['lat', 'lon', 'city', 'village', 'subDistrict', 'pincode']
      .filter((k) => f.location[k] != null && f.location[k] !== '').map((k) => [k, f.location[k]])) : {}),
    ...(f.state.trim() ? { state: f.state.trim() } : {}),
    ...(f.district.trim() ? { district: f.district.trim() } : {}),
    ...(f.areaAcres !== '' ? { areaAcres: Number(f.areaAcres) } : {}),
  };
}

/** Two-tap delete (no browser confirm dialog). */
function DeleteButton({ onDelete, label, compact = false }) {
  const { t } = useTranslation();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <Button type="button" variant={armed ? 'danger' : 'ghost'} className={compact ? 'min-h-10 px-2 text-sm' : 'text-sm'}
      onClick={() => (armed ? onDelete() : setArmed(true))} aria-label={armed ? t('fields.confirmDelete') : label}>
      <Trash2 className="size-4" aria-hidden />{(armed || !compact) && <span>{armed ? t('fields.confirmDelete') : label}</span>}
    </Button>
  );
}

function FieldEditor({ initial, districts, onSaved, onCancel }) {
  const { t } = useTranslation();
  const [f, setF] = useState(initial);
  const [state, setState] = useState({ saving: false, error: '', errors: {} });
  const [autoFilled, setAutoFilled] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  // A picked location fills district + state (still editable). If the place name matches a district in
  // the soil table, use that table's spelling so the district-soil lookup finds it.
  const onLocation = (loc) => {
    const match = loc?.district && districts.find((d) => d.district.toLowerCase() === loc.district.toLowerCase());
    setF((x) => ({
      ...x,
      location: loc,
      district: match?.district ?? loc?.district ?? x.district,
      state: match?.state ?? loc?.state ?? x.state,
    }));
    setAutoFilled(Boolean(loc?.district || loc?.state));
  };

  const save = async () => {
    if (!f.name.trim()) return setState({ saving: false, error: '', errors: { name: t('fields.name') } });
    setState({ saving: true, error: '', errors: {} });
    try {
      const { data } = initial.id
        ? await api.put(`/fields/${initial.id}`, fieldPayload(f))
        : await api.post('/fields', fieldPayload(f));
      onSaved(data);
    } catch (err) {
      setState({ saving: false, error: errorMessage(err, t), errors: fieldErrors(err) });
    }
  };

  return (
    <div className="space-y-3">
      <Field id="fld-name" label={t('fields.name')} error={state.errors.name}>
        <input id="fld-name" className={inputClass} value={f.name} maxLength={60} placeholder={t('fields.namePlaceholder')}
          onChange={(e) => set('name', e.target.value)} />
      </Field>
      <div>
        <p className="mb-1 font-medium text-ink-soft">{t('fields.location')}</p>
        <LocationPicker value={f.location} onChange={onLocation} />
      </div>
      {autoFilled && <Notice tone="success">{t('places.autoFilled')}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field id="fld-state" label={t('fields.state')} optional optionalLabel={t('common.optional')}>
          <input id="fld-state" className={inputClass} value={f.state} maxLength={80} onChange={(e) => set('state', e.target.value)} />
        </Field>
        <Field id="fld-district" label={t('fields.district')} optional optionalLabel={t('common.optional')}>
          <input id="fld-district" className={inputClass} value={f.district} maxLength={80} list="district-list"
            onChange={(e) => {
              const match = districts.find((d) => d.district.toLowerCase() === e.target.value.toLowerCase());
              setF((x) => ({ ...x, district: e.target.value, ...(match && !x.state ? { state: match.state } : {}) }));
            }} />
          <datalist id="district-list">
            {districts.map((d) => <option key={`${d.state}-${d.district}`} value={d.district}>{d.state}</option>)}
          </datalist>
        </Field>
        <Field id="fld-area" label={t('fields.areaAcres')} optional optionalLabel={t('common.optional')}>
          <input id="fld-area" type="number" inputMode="decimal" min="0" max="10000" step="0.1" className={inputClass}
            value={f.areaAcres} onChange={(e) => set('areaAcres', e.target.value)} />
        </Field>
      </div>
      <ErrorAlert message={state.error} />
      <div className="flex gap-2">
        <Button type="button" onClick={save} loading={state.saving} className="flex-1">{t('fields.save')}</Button>
        {onCancel && <Button type="button" variant="secondary" onClick={onCancel}>{t('fields.cancel')}</Button>}
      </div>
    </div>
  );
}

function TrendIcon({ value }) {
  if (!value) return <Minus className="size-4 text-ink-muted" aria-hidden />;
  return value > 0
    ? <ArrowUpRight className="size-4 text-ink-soft" aria-hidden />
    : <ArrowDownRight className="size-4 text-ink-soft" aria-hidden />;
}

function SoilTests({ fieldId, tests, summary, onChange }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState({ testedAt: today(), N: '', P: '', K: '', ph: '', source: 'soil_health_card' });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ saving: false, error: '' });
  const fmtDate = (d) => new Intl.DateTimeFormat(intlLocale(i18n.resolvedLanguage), { dateStyle: 'medium' }).format(new Date(d));

  const onField = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => ({ ...e, [k]: '' })); };

  const add = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(SOIL.map((k) => [k, rangeError(k, form[k], t)]).filter(([, m]) => m));
    setErrors(v);
    if (Object.keys(v).length) return;
    setState({ saving: true, error: '' });
    try {
      await api.post(`/fields/${fieldId}/soil-tests`, { ...form, ...Object.fromEntries(SOIL.map((k) => [k, Number(form[k])])) });
      setForm((f) => ({ ...f, N: '', P: '', K: '', ph: '' }));
      setState({ saving: false, error: '' });
      onChange();
    } catch (err) {
      setErrors(fieldErrors(err));
      setState({ saving: false, error: errorMessage(err, t) });
    }
  };

  const remove = async (id) => {
    try { await api.delete(`/fields/${fieldId}/soil-tests/${id}`); onChange(); } catch (err) { setState({ saving: false, error: errorMessage(err, t) }); }
  };

  return (
    <Card title={t('fields.soilTests')} icon={FlaskRound}>
      {summary && (
        <div className="mb-3 rounded-xl bg-brand-50 p-3 ring-1 ring-brand-200">
          <p className="mb-2 text-sm font-semibold text-brand-800">{t('fields.estimate')}</p>
          <dl className="grid grid-cols-4 gap-2 text-center">
            {SOIL.map((k) => (
              <div key={k}>
                <dt className="text-xs text-ink-soft">{k === 'ph' ? 'pH' : t(`nutrients.${k}`, k)}</dt>
                <dd className="text-lg font-bold tabular-nums text-ink">{summary.values[k]}</dd>
                {summary.trendPerYear && (
                  <dd className="flex items-center justify-center gap-0.5 text-xs tabular-nums text-ink-soft">
                    <TrendIcon value={summary.trendPerYear[k]} />
                    {summary.trendPerYear[k] > 0 ? '+' : ''}{summary.trendPerYear[k]}
                  </dd>
                )}
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-ink-soft">{summary.trendPerYear ? t('fields.trend') : t('fields.trendNeedsMore')}</p>
        </div>
      )}

      {tests.length ? (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-soft">
                <th className="py-1 pr-2 font-medium">{t('fields.testedAt')}</th>
                {SOIL.map((k) => <th key={k} className="px-1 py-1 text-right font-medium">{k === 'ph' ? 'pH' : k}</th>)}
                <th className="sr-only">{t('fields.remove')}</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="py-1 pr-2 text-ink">{fmtDate(s.testedAt)}<span className="block text-xs text-ink-muted">{t(`fields.sources.${s.source}`)}</span></td>
                  {SOIL.map((k) => <td key={k} className="px-1 py-1 text-right tabular-nums text-ink">{s[k]}</td>)}
                  <td className="py-1 text-right"><DeleteButton compact label={t('fields.remove')} onDelete={() => remove(s.id)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="mb-3 text-ink-soft">{t('fields.noTests')}</p>}

      <form onSubmit={add} noValidate className="space-y-3 border-t border-line pt-3">
        <h3 className="font-semibold text-ink">{t('fields.addTest')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field id="st-date" label={t('fields.testedAt')}>
            <input id="st-date" type="date" max={today()} className={inputClass} value={form.testedAt} onChange={(e) => onField('testedAt', e.target.value)} />
          </Field>
          <Field id="st-source" label={t('fields.source')}>
            <select id="st-source" className={inputClass} value={form.source} onChange={(e) => onField('source', e.target.value)}>
              {['soil_health_card', 'lab', 'self'].map((s) => <option key={s} value={s}>{t(`fields.sources.${s}`)}</option>)}
            </select>
          </Field>
          {SOIL.map((k) => <NumberField key={k} name={k} label={t(`crop.${k}`)} value={form[k]} onChange={onField} error={errors[k]} />)}
        </div>
        <ErrorAlert message={state.error} />
        <Button type="submit" variant="secondary" loading={state.saving} className="w-full"><Plus className="size-5" aria-hidden />{t('fields.addTest')}</Button>
      </form>
    </Card>
  );
}

function CropHistoryCard({ fieldId, rows, onChange }) {
  const { t } = useTranslation();
  const year = new Date().getFullYear();
  const [form, setForm] = useState({ year: String(year), season: 'Kharif', crop: '', yieldQuintalPerAcre: '' });
  const [state, setState] = useState({ saving: false, error: '' });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const add = async (e) => {
    e.preventDefault();
    if (form.crop.trim().length < 2) return;
    setState({ saving: true, error: '' });
    try {
      await api.post(`/fields/${fieldId}/crops`, {
        year: Number(form.year), season: form.season, crop: form.crop.trim(),
        ...(form.yieldQuintalPerAcre !== '' ? { yieldQuintalPerAcre: Number(form.yieldQuintalPerAcre) } : {}),
      });
      setForm((f) => ({ ...f, crop: '', yieldQuintalPerAcre: '' }));
      setState({ saving: false, error: '' });
      onChange();
    } catch (err) {
      setState({ saving: false, error: errorMessage(err, t) });
    }
  };

  const remove = async (id) => {
    try { await api.delete(`/fields/${fieldId}/crops/${id}`); onChange(); } catch (err) { setState({ saving: false, error: errorMessage(err, t) }); }
  };

  return (
    <Card title={t('fields.cropHistory')} icon={Wheat}>
      {rows.length ? (
        <ul className="mb-3 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <Badge tone="green">{t(`crop.seasonNames.${r.season}`, r.season)} {r.year}</Badge>
              <span className="flex-1 font-semibold text-ink">{t(`crops.${r.crop}`, r.crop)}</span>
              {r.yieldQuintalPerAcre != null && <span className="text-sm tabular-nums text-ink-soft">{r.yieldQuintalPerAcre} q/acre</span>}
              <DeleteButton compact label={t('fields.remove')} onDelete={() => remove(r.id)} />
            </li>
          ))}
        </ul>
      ) : <p className="mb-3 text-ink-soft">{t('fields.noCrops')}</p>}

      <form onSubmit={add} className="space-y-3 border-t border-line pt-3">
        <h3 className="font-semibold text-ink">{t('fields.addCrop')}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field id="ch-crop" label={t('fields.crop')}>
            <input id="ch-crop" className={inputClass} value={form.crop} list="crop-list" maxLength={40} required onChange={(e) => set('crop', e.target.value)} />
            <datalist id="crop-list">
              {[...CROPS, 'wheat', 'sugarcane', 'mustard', 'soybean', 'groundnut', 'bajra', 'jowar', 'ragi'].map((c) =>
                <option key={c} value={c}>{t(`crops.${c}`, c)}</option>)}
            </datalist>
          </Field>
          <Field id="ch-season" label={t('fields.season')}>
            <select id="ch-season" className={inputClass} value={form.season} onChange={(e) => set('season', e.target.value)}>
              {SEASONS.map((s) => <option key={s} value={s}>{t(`crop.seasonNames.${s}`, s)}</option>)}
            </select>
          </Field>
          <Field id="ch-year" label={t('fields.year')}>
            <select id="ch-year" className={inputClass} value={form.year} onChange={(e) => set('year', e.target.value)}>
              {Array.from({ length: 8 }, (_, i) => year + 1 - i).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field id="ch-yield" label={t('fields.yield')} optional optionalLabel={t('common.optional')}>
            <input id="ch-yield" type="number" inputMode="decimal" min="0" max="1000" step="0.1" className={inputClass}
              value={form.yieldQuintalPerAcre} onChange={(e) => set('yieldQuintalPerAcre', e.target.value)} />
          </Field>
        </div>
        <ErrorAlert message={state.error} />
        <Button type="submit" variant="secondary" loading={state.saving} className="w-full"><Plus className="size-5" aria-hidden />{t('fields.addCrop')}</Button>
      </form>
    </Card>
  );
}

export default function FieldsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('field');
  const [fields, setFields] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null); // null | 'new' | 'edit'
  const [error, setError] = useState('');
  const [districts, setDistricts] = useState([]);

  const loadFields = useCallback(async () => {
    try {
      const { data } = await api.get('/fields');
      setFields(data.items);
      if (!selectedId && data.items.length) setParams({ field: data.items[0].id }, { replace: true });
      if (!data.items.length) setEditing('new');
    } catch (err) {
      setError(errorMessage(err, t));
      setFields([]);
    }
  }, [selectedId, setParams, t]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return setDetail(null);
    try {
      const { data } = await api.get(`/fields/${selectedId}`);
      setDetail(data);
    } catch (err) {
      setDetail(null);
      setError(errorMessage(err, t));
    }
  }, [selectedId, t]);

  useEffect(() => { loadFields(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadDetail(); }, [loadDetail]);
  // District list for autocomplete; empty (and harmless) until the district soil data is installed.
  useEffect(() => { api.get('/recommend/districts').then(({ data }) => setDistricts(data.districts ?? [])).catch(() => {}); }, []);

  const onSaved = (field) => {
    setEditing(null);
    setFields((fs) => {
      const rest = (fs ?? []).filter((x) => x.id !== field.id);
      return [...rest, field];
    });
    setParams({ field: field.id });
    loadDetail();
  };

  const removeField = async (id) => {
    try {
      await api.delete(`/fields/${id}`);
      const left = fields.filter((f) => f.id !== id);
      setFields(left);
      setParams(left.length ? { field: left[0].id } : {});
      if (!left.length) setEditing('new');
    } catch (err) {
      setError(errorMessage(err, t));
    }
  };

  if (fields === null) return <Spinner label={t('common.loading')} />;
  const field = detail?.field;
  const toEditable = (f) => ({
    id: f.id, name: f.name, state: f.state ?? '', district: f.district ?? '', areaAcres: f.areaAcres ?? '',
    location: f.lat != null
      ? { lat: f.lat, lon: f.lon, city: f.city, village: f.village, subDistrict: f.subDistrict, district: f.district, state: f.state, pincode: f.pincode }
      : null,
  });

  return (
    <div>
      <PageHeader title={t('fields.title')} subtitle={t('fields.subtitle')} />
      <ErrorAlert message={error} />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label={t('fields.title')}>
        {fields.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={f.id === selectedId}
            onClick={() => { setEditing(null); setParams({ field: f.id }); }}
            className={`min-h-11 rounded-full px-4 font-semibold ring-1 ${f.id === selectedId ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-ink ring-line-strong hover:bg-brand-50'}`}>
            {f.name}
          </button>
        ))}
        <Button type="button" variant="secondary" className="min-h-11 rounded-full" onClick={() => setEditing('new')}>
          <Plus className="size-5" aria-hidden />{t('fields.add')}
        </Button>
      </div>

      {editing && (
        <Card title={editing === 'new' ? t('fields.add') : t('fields.edit')} icon={Tractor} className="mb-4">
          {!fields.length && <div className="mb-3"><Notice>{t('fields.empty')}</Notice></div>}
          <FieldEditor
            key={editing === 'new' ? 'new' : field?.id}
            initial={editing === 'new' || !field ? EMPTY_FIELD : toEditable(field)}
            districts={districts}
            onSaved={onSaved}
            onCancel={fields.length ? () => setEditing(null) : undefined}
          />
        </Card>
      )}

      {!editing && field && (
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="space-y-4">
            <Card title={field.name} icon={Tractor}
              action={<Button type="button" variant="ghost" className="text-sm" onClick={() => setEditing('edit')}>{t('fields.edit')}</Button>}>
              <p className="flex items-center gap-2 text-ink-soft">
                <MapPin className="size-5 text-brand-700" aria-hidden />
                {field.lat != null ? placeName({ lat: field.lat, lon: field.lon, city: field.city }) : t('fields.noLocation')}
              </p>
              <div className="mt-2"><AddressSummary value={field} /></div>
              {field.areaAcres != null && <p className="mt-1 text-ink-soft">{field.areaAcres} {t('fields.areaAcres').replace(/^.*\((.*)\).*$/, '$1')}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to={`/crop?field=${field.id}`} className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 font-semibold text-white hover:bg-brand-700">
                  <Sprout className="size-5" aria-hidden />{t('fields.recommend')}
                </Link>
                <DeleteButton label={t('fields.delete')} onDelete={() => removeField(field.id)} />
              </div>
            </Card>
            <CropHistoryCard fieldId={field.id} rows={detail.cropHistory} onChange={loadDetail} />
          </div>
          <SoilTests fieldId={field.id} tests={detail.soilTests} summary={detail.soilSummary} onChange={loadDetail} />
        </div>
      )}
      {!editing && !field && fields.length > 0 && <p className="text-ink-soft">{t('fields.select')}</p>}
    </div>
  );
}
