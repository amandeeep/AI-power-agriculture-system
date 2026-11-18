// Disease diagnosis card: confidence, treatment (organic / chemical / prevention), other possibilities.
import { useTranslation } from 'react-i18next';
import { CheckCircle2, HelpCircle, ShieldAlert } from 'lucide-react';
import { Badge, Notice } from '../ui';

const pct = (x) => Math.round((x ?? 0) * 100);

function ConfidenceBar({ value, label }) {
  const tone = value >= 0.8 ? 'bg-brand-600' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm text-ink-soft"><span>{label}</span><b className="tabular-nums text-ink">{pct(value)}%</b></div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100" role="meter" aria-valuenow={pct(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct(value)}%` }} />
      </div>
    </div>
  );
}

function Section({ title, items, tone }) {
  if (!items?.length) return null;
  return (
    <div>
      <h3 className={`mb-1 font-bold ${tone ?? 'text-ink'}`}>{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-ink-soft">{items.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

export default function DiseaseResults({ data }) {
  const { t } = useTranslation();
  if (!data) return null;

  if (data.no_leaf) {
    return <Notice tone="warning" icon={HelpCircle}><b>{t('disease.noLeaf')}.</b> {t('disease.noLeafHint')}</Notice>;
  }

  if (data.uncertain) {
    return (
      <div className="space-y-3">
        <Notice tone="warning" icon={HelpCircle}><b>{t('disease.uncertain')}.</b> {t('disease.uncertainHint')}</Notice>
        <ConfidenceBar value={data.confidence} label={t('common.confidence')} />
        <OtherPossibilities data={data} t={t} />
      </div>
    );
  }

  const tr = data.treatment;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xl font-bold text-ink">{data.crop}: {data.disease}</h3>
        {data.healthy ? <Badge tone="green"><CheckCircle2 className="size-3.5" />{t('disease.healthy')}</Badge> : null}
      </div>
      <ConfidenceBar value={data.confidence} label={t('common.confidence')} />
      {tr?.pathogen && <p className="text-sm text-ink-soft"><b>{t('disease.pathogen')}:</b> {tr.pathogen}</p>}
      {tr?.symptoms && <div><h3 className="mb-1 font-bold text-ink">{t('disease.symptoms')}</h3><p className="text-ink-soft">{tr.symptoms}</p></div>}
      <Section title={t('disease.organic')} items={tr?.organic} tone="text-brand-800" />
      <Section title={t('disease.chemical')} items={tr?.chemical} tone="text-amber-800" />
      <Section title={t('disease.prevention')} items={tr?.prevention} />
      {!data.healthy && <Notice tone="warning" icon={ShieldAlert}>{t('common.chemSafety')} {t('common.disclaimer')}</Notice>}
      <OtherPossibilities data={data} t={t} />
      {data.model_version && <p className="text-xs text-ink-muted">{t('common.modelVersion')}: {data.model_version}</p>}
    </div>
  );
}

function OtherPossibilities({ data, t }) {
  const others = (data.top3 ?? []).slice(data.uncertain ? 0 : 1);
  if (!others.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-bold text-ink-soft">{t('disease.top3')}</h3>
      <ul className="space-y-1 text-sm text-ink-soft">
        {others.map((o) => <li key={o.label} className="flex justify-between gap-2"><span>{o.crop}: {o.disease}</span><span className="tabular-nums">{pct(o.confidence)}%</span></li>)}
      </ul>
    </div>
  );
}
