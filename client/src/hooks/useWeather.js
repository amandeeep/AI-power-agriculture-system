// Fetches /api/weather for a location (the server caches for 30 minutes).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, errorMessage } from '../lib/api';

export default function useWeather(location) {
  const { t } = useTranslation();
  const [state, setState] = useState({ data: null, loading: false, error: '' });
  const lat = location?.lat;
  const lon = location?.lon;

  const load = useCallback(async () => {
    if (lat == null || lon == null) return;
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const { data } = await api.get('/weather', { params: { lat, lon } });
      setState({ data, loading: false, error: '' });
    } catch (err) {
      setState({ data: null, loading: false, error: errorMessage(err, t) });
    }
  }, [lat, lon, t]);

  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
