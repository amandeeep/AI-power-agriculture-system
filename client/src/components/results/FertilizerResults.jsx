// Fertilizer plan: NPK actual-vs-ideal chart, status badges, products in kg/acre, organic options, warnings.
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CheckCircle2, Leaf, ShieldAlert } from 'lucide-react';
import { SERIES } from '../../lib/constants';
import { Badge, Notice } from '../ui';

const STATUS_TONE = { deficient: 'amber', optimal: 'green', excess: 'red' };

export default function FertilizerResults({ data }) {
  const { t } = useTranslation();
  if (!data?.nutrients) return null;
  const rows = Object.entries(data.nutrients).map(([n, v]) => ({ name: `${t(`nutrients.${n}`)} (${n})`, actual: v.actual, ideal: v.ideal }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(data.nutrients).map(([n, v]) => (
          <Badge key={n} tone={STATUS_TONE[v.status]}>{n}: {t(`fertilizer.status.${v.status}`)}</Badge>
        ))}
      </div>

      <figure>
        <figcaption className="mb-1 text-sm font-semibold text-ink-soft">{t('fertilizer.chartTitle')}</figcaption>
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -12 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="#e5e4e0" />
              <XAxis dataKey="name" tick={{ fill: '#334155', fontSize: 11 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: '#52514e', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: 'rgba(22,163,74,0.06)' }} formatter={(v) => [`${v} kg/ha`]} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#334155' }} />
              <Bar dataKey="actual" name={t('fertilizer.actual')} fill={SERIES.blue} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="ideal" name={t('fertilizer.ideal')} fill={SERIES.orange} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <div>
        <h3 className="mb-2 font-bold text-ink">{t('fertilizer.plan')}</h3>
        {data.fertilizers?.length ? (
          <ul className="space-y-2">
            {data.fertilizers.map((f) => (
              <li key={f.name} className="rounded-xl bg-mint p-3 ring-1 ring-line">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-bold text-ink">{f.name} <span className="text-sm font-normal text-ink-muted">({f.grade})</span></span>
                  <span className="text-lg font-bold tabular-nums text-brand-800">{f.kg_per_acre} <span className="text-sm font-medium">{t('common.kgPerAcre')}</span></span>
                </div>
                {f.when && <p className="mt-1 text-sm text-ink-soft">{f.when}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <Notice tone="success" icon={CheckCircle2}>{t('fertilizer.balanced')}</Notice>
        )}
      </div>

      {data.warnings?.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold text-ink">{t('fertilizer.warnings')}</h3>
          {data.warnings.map((w) => <Notice key={w} tone="warning" icon={AlertTriangle}>{w}</Notice>)}
        </div>
      )}

      {data.organic_alternatives && Object.keys(data.organic_alternatives).length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-2 font-bold text-ink"><Leaf className="size-5 text-brand-700" />{t('fertilizer.organic')}</h3>
          {Object.entries(data.organic_alternatives).map(([n, list]) => (
            <div key={n} className="mb-2">
              <p className="text-sm font-semibold text-ink-soft">{t(`nutrients.${n}`)} ({n})</p>
              <ul className="list-disc pl-5 text-sm text-ink-soft">{list.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          ))}
        </div>
      )}

      <Notice tone="info" icon={ShieldAlert}>{t('common.disclaimer')}</Notice>
      {data.model_version && <p className="text-xs text-ink-muted">{t('common.modelVersion')}: {data.model_version}</p>}
    </div>
  );
}
