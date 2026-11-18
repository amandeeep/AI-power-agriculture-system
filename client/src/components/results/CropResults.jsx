// Top-5 crop recommendation with a stacked score-breakdown chart (soil match / season / weather, plus
// rotation and nearby-farms fit for location-based results).
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Info } from 'lucide-react';
import { SERIES } from '../../lib/constants';
import { Badge, Notice } from '../ui';

const pct = (x) => Math.round((x ?? 0) * 100);

function BreakdownTooltip({ active, payload, label, t }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg bg-white p-3 text-sm shadow-lg ring-1 ring-black/10">
      <p className="mb-1 font-bold text-ink">{label}</p>
      <p className="text-ink-soft">{t('crop.finalScore')}: <b>{pct(row.final)}%</b></p>
      <p className="text-ink-soft">{t('crop.probability')}: {pct(row.probability)}%</p>
      <p className="text-ink-soft">{t('crop.season')}: {pct(row.seasonScore)}%</p>
      <p className="text-ink-soft">{t('crop.weather')}: {pct(row.weatherScore)}%</p>
      {row.rotationScore != null && <p className="text-ink-soft">{t('crop.rotation')}: {pct(row.rotationScore)}%</p>}
      {row.areaScore != null && <p className="text-ink-soft">{t('crop.area')}: {pct(row.areaScore)}%</p>}
    </div>
  );
}

export default function CropResults({ data, compact = false }) {
  const { t } = useTranslation();
  if (!data?.top?.length) return null;
  const w = data.weights ?? { probability: 0.6, season: 0.2, weather: 0.2 };

  // Each segment = the weighted contribution of that component (in percentage points of the overall score).
  const rows = data.top.map((c) => ({
    name: t(`crops.${c.crop}`, c.crop),
    soil: Math.round(c.probability * w.probability * 1000) / 10,
    season: Math.round(c.season_score * w.season * 1000) / 10,
    weather: Math.round(c.weather_score * w.weather * 1000) / 10,
    rotation: c.rotation_score != null ? Math.round(c.rotation_score * (w.rotation ?? 0) * 1000) / 10 : 0,
    area: c.area_score != null ? Math.round(c.area_score * (w.area ?? 0) * 1000) / 10 : 0,
    final: c.final_score, probability: c.probability, seasonScore: c.season_score, weatherScore: c.weather_score,
    rotationScore: c.rotation_score, areaScore: c.area_score,
  }));
  const hasRotation = data.top.some((c) => c.rotation_score != null);
  const hasArea = data.top.some((c) => c.area_score != null);
  // Formula built from the weights actually used, e.g. "Overall = 48% Soil match + 16% Season fit + ...".
  const parts = [['probability', 'crop.probability'], ['season', 'crop.season'], ['weather', 'crop.weather'],
    ['rotation', 'crop.rotation'], ['area', 'crop.area']].filter(([k]) => w[k] != null);
  const formula = `${t('crop.formulaPrefix')} ${parts.map(([k, label]) => `${Math.round(w[k] * 100)}% ${t(label)}`).join(' + ')}`;
  const seasonName = t(`crop.seasonNames.${data.current_season}`, data.current_season);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {data.current_season && <Badge tone="green">{t('crop.currentSeason', { season: seasonName })}</Badge>}
        {data.liveWeatherUsed && <Badge tone="blue">{t('crop.liveWeatherUsed')}</Badge>}
      </div>

      <ol className="space-y-2">
        {data.top.map((c, i) => (
          <li key={c.crop} className={`flex items-center gap-3 rounded-xl p-2 ${i === 0 ? 'bg-brand-50 ring-1 ring-brand-200' : ''}`}>
            <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${i === 0 ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink-soft'}`}>{i + 1}</span>
            <span className="flex-1">
              <span className="block font-semibold text-ink">{t(`crops.${c.crop}`, c.crop)}</span>
              {c.rotation_reason && <span className="block text-xs text-ink-soft">{t(`crop.rotationReasons.${c.rotation_reason}`, c.rotation_reason)}</span>}
            </span>
            <span className="text-lg font-bold tabular-nums text-brand-800">{pct(c.final_score)}%</span>
          </li>
        ))}
      </ol>

      <figure>
        <figcaption className="mb-1 text-sm font-semibold text-ink-soft">{t('crop.chartTitle')}</figcaption>
        <div style={{ height: rows.length * 40 + 70 }} className="w-full">
          <ResponsiveContainer>
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke="#e5e4e0" />
              <XAxis type="number" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}`} tick={{ fill: '#52514e', fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={compact ? 92 : 120} tick={{ fill: '#334155', fontSize: 12 }} axisLine={false} tickLine={false} />
              <Tooltip content={<BreakdownTooltip t={t} />} cursor={{ fill: 'rgba(22,163,74,0.06)' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: '#334155' }} />
              <Bar dataKey="soil" name={t('crop.probability')} stackId="s" fill={SERIES.blue} stroke="#fff" strokeWidth={2} barSize={18} />
              <Bar dataKey="season" name={t('crop.season')} stackId="s" fill={SERIES.orange} stroke="#fff" strokeWidth={2} barSize={18} />
              <Bar dataKey="weather" name={t('crop.weather')} stackId="s" fill={SERIES.aqua} stroke="#fff" strokeWidth={2} barSize={18} radius={hasRotation || hasArea ? 0 : [0, 4, 4, 0]} />
              {hasRotation && <Bar dataKey="rotation" name={t('crop.rotation')} stackId="s" fill={SERIES.yellow} stroke="#fff" strokeWidth={2} barSize={18} radius={hasArea ? 0 : [0, 4, 4, 0]} />}
              {hasArea && <Bar dataKey="area" name={t('crop.area')} stackId="s" fill={SERIES.magenta} stroke="#fff" strokeWidth={2} barSize={18} radius={[0, 4, 4, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <Notice icon={Info}>{formula}</Notice>
      {data.model_version && <p className="text-xs text-ink-muted">{t('common.modelVersion')}: {data.model_version}</p>}
    </div>
  );
}
