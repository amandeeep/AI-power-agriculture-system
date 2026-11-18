// The farmer's saved predictions (from forms and chat), filterable and paginated.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, ChevronDown, ChevronUp, FlaskConical, MessageCircle, Sprout } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { intlLocale } from '../lib/constants';
import CropResults from '../components/results/CropResults';
import DiseaseResults from '../components/results/DiseaseResults';
import FertilizerResults from '../components/results/FertilizerResults';
import { Badge, Button, Card, ErrorAlert, PageHeader, Spinner } from '../components/ui';

const TYPES = ['', 'crop', 'fertilizer', 'disease'];
const ICON = { crop: Sprout, fertilizer: FlaskConical, disease: Bug };

function summary(p, t) {
  const o = p.output ?? {};
  if (p.type === 'crop') return `${t('history.topCrop')}: ${t(`crops.${o.top?.[0]?.crop}`, o.top?.[0]?.crop ?? '')}`;
  if (p.type === 'fertilizer') {
    const plan = (o.fertilizers ?? []).map((f) => `${f.name} ${f.kg_per_acre}`).join(', ');
    return `${t(`crops.${o.crop}`, o.crop ?? '')}${plan ? `: ${plan} ${t('common.kgPerAcre')}` : ''}`;
  }
  if (p.type === 'disease') return o.uncertain ? t('history.uncertain') : `${o.crop}: ${o.disease}`;
  return '';
}

function HistoryItem({ p }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const Icon = ICON[p.type];
  const when = new Intl.DateTimeFormat(intlLocale(i18n.resolvedLanguage), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.createdAt));
  return (
    <li className="rounded-2xl bg-white shadow-sm ring-1 ring-black/5">
      <button onClick={() => setOpen((o) => !o)} className="flex min-h-16 w-full items-center gap-3 p-3 text-left" aria-expanded={open}>
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-100 text-brand-700"><Icon className="size-5" aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">{summary(p, t)}</span>
          <span className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            {when}
            <Badge tone={p.source === 'chat' ? 'blue' : 'neutral'}>
              {p.source === 'chat' && <MessageCircle className="size-3" aria-hidden />}{t(`history.source.${p.source}`)}
            </Badge>
          </span>
        </span>
        {open ? <ChevronUp className="size-5 text-ink-muted" /> : <ChevronDown className="size-5 text-ink-muted" />}
      </button>
      {open && (
        <div className="border-t border-line p-3">
          {p.type === 'crop' && <CropResults data={p.output} compact />}
          {p.type === 'fertilizer' && <FertilizerResults data={p.output} />}
          {p.type === 'disease' && <DiseaseResults data={p.output} />}
        </div>
      )}
    </li>
  );
}

export default function HistoryPage() {
  const { t } = useTranslation();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ loading: true, error: '', data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const { data } = await api.get('/history', { params: { page, limit: 10, ...(type ? { type } : {}) } });
      setState({ loading: false, error: '', data });
    } catch (err) {
      setState({ loading: false, error: errorMessage(err, t), data: null });
    }
  }, [page, type, t]);
  useEffect(() => { load(); }, [load]);

  const d = state.data;
  return (
    <div>
      <PageHeader title={t('history.title')} />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TYPES.map((ty) => (
          <button key={ty || 'all'} role="tab" aria-selected={type === ty} onClick={() => { setType(ty); setPage(1); }}
            className={`min-h-11 shrink-0 rounded-full px-4 font-semibold ${type === ty ? 'bg-brand-600 text-white' : 'bg-white text-ink-soft ring-1 ring-line'}`}>
            {ty ? t(`nav.${ty}`) : t('history.all')}
          </button>
        ))}
      </div>
      {state.loading && !d ? <Spinner label={t('common.loading')} />
        : state.error ? <ErrorAlert message={state.error} onRetry={load} retryLabel={t('common.retry')} />
        : !d?.items.length ? <Card><p className="text-ink-soft">{t('history.empty')}</p></Card>
        : (
          <>
            <ul className={`space-y-3 ${state.loading ? 'opacity-60' : ''}`}>{d.items.map((p) => <HistoryItem key={p.id} p={p} />)}</ul>
            {d.pages > 1 && (
              <div className="mt-4 flex items-center justify-between gap-2">
                <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t('history.prev')}</Button>
                <span className="text-ink-soft">{t('history.page', { page: d.page, pages: d.pages })}</span>
                <Button variant="secondary" disabled={page >= d.pages} onClick={() => setPage((p) => p + 1)}>{t('history.next')}</Button>
              </div>
            )}
          </>
        )}
    </div>
  );
}
