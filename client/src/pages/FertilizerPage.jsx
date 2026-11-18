// Fertilizer form -> POST /api/predict/fertilizer -> NPK chart + plan.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { CROPS } from '../lib/constants';
import NumberField, { rangeError } from '../components/NumberField';
import FertilizerResults from '../components/results/FertilizerResults';
import { Button, Card, ErrorAlert, Field, inputClass, PageHeader } from '../components/ui';

export default function FertilizerPage() {
  const { t } = useTranslation();
  const [form, setForm] = useState({ crop: '', N: '', P: '', K: '' });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ loading: false, error: '', result: null });
  const resultRef = useRef(null);

  const onChange = (name, value) => {
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((e) => ({ ...e, [name]: '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(['N', 'P', 'K'].map((k) => [k, rangeError(k, form[k], t)]).filter(([, m]) => m));
    if (!form.crop) v.crop = t('common.required');
    setErrors(v);
    if (Object.keys(v).length) return;
    setState({ loading: true, error: '', result: null });
    try {
      const { data } = await api.post('/predict/fertilizer', { crop: form.crop, N: Number(form.N), P: Number(form.P), K: Number(form.K) });
      setState({ loading: false, error: '', result: data });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      setErrors(fieldErrors(err));
      setState({ loading: false, error: errorMessage(err, t), result: null });
    }
  };

  const sortedCrops = [...CROPS].sort((a, b) => t(`crops.${a}`).localeCompare(t(`crops.${b}`)));

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div>
        <PageHeader title={t('fertilizer.title')} subtitle={t('fertilizer.subtitle')} />
        <form onSubmit={submit} noValidate>
          <Card>
            <div className="space-y-4">
              <Field id="f-crop" label={t('fertilizer.cropLabel')} error={errors.crop}>
                <select id="f-crop" className={inputClass} value={form.crop} onChange={(e) => onChange('crop', e.target.value)} aria-invalid={Boolean(errors.crop)}>
                  <option value="">{t('fertilizer.selectCrop')}</option>
                  {sortedCrops.map((c) => <option key={c} value={c}>{t(`crops.${c}`)}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
                {['N', 'P', 'K'].map((k) => <NumberField key={k} name={k} label={t(`crop.${k}`)} value={form[k]} onChange={onChange} error={errors[k]} />)}
              </div>
              <ErrorAlert message={state.error} />
              <Button type="submit" loading={state.loading} className="w-full"><FlaskConical className="size-5" aria-hidden />{t('fertilizer.submit')}</Button>
            </div>
          </Card>
        </form>
      </div>
      <div ref={resultRef} className="scroll-mt-20 lg:sticky lg:top-20">
        {state.result && (
          <Card title={`${t('fertilizer.nutrients')}: ${t(`crops.${state.result.crop}`, state.result.crop)}`} icon={FlaskConical}>
            <FertilizerResults data={state.result} />
          </Card>
        )}
      </div>
    </div>
  );
}
