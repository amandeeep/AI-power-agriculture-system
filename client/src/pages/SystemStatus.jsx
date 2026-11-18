// Phase 1 placeholder: shows live health of the API, database and ML service.
// Replaced by the real Dashboard in Phase 6 (kept at /status for debugging).
import { useEffect, useState } from 'react';
import { api, errorMessage } from '../lib/api';

function Pill({ ok, label }) {
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-medium ${ok ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-800'}`}>
      {label}
    </span>
  );
}

export default function SystemStatus() {
  const [state, setState] = useState({ loading: true });

  const load = () => {
    setState({ loading: true });
    api.get('/health')
      .then((res) => setState({ data: res.data }))
      .catch((err) => setState({ error: errorMessage(err) }));
  };
  useEffect(load, []);

  const d = state.data;
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="mb-1 text-2xl font-bold text-brand-800">🌱 Agri-DSS</h1>
      <p className="mb-6 text-slate-600">System status</p>

      <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        {state.loading && <p className="text-slate-500">Checking services…</p>}
        {state.error && <p className="text-red-700">API unreachable: {state.error}</p>}
        {d && (
          <>
            <Row name="API server"><Pill ok label={`ok · up ${d.uptimeSec}s`} /></Row>
            <Row name="MongoDB"><Pill ok={d.db === 'connected'} label={d.db} /></Row>
            <Row name="ML service"><Pill ok={d.mlService.status === 'ok'} label={d.mlService.status} /></Row>
            {d.mlService.models &&
              Object.entries(d.mlService.models).map(([name, loaded]) => (
                <Row key={name} name={`· ${name} model`} sub><Pill ok={loaded} label={loaded ? 'loaded' : 'not loaded'} /></Row>
              ))}
            <Row name="Gemini"><Pill ok={d.gemini === 'configured'} label={d.gemini} /></Row>
          </>
        )}
        <button onClick={load} className="mt-2 min-h-12 w-full rounded-xl bg-brand-600 font-semibold text-white active:bg-brand-700">
          Refresh
        </button>
      </section>
    </main>
  );
}

function Row({ name, sub, children }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${sub ? 'pl-3 text-sm text-slate-600' : ''}`}>
      <span>{name}</span>
      {children}
    </div>
  );
}
