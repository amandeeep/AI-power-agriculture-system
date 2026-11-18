// Farm location: browser geolocation (then the address is filled in from the coordinates), or
// type-ahead search for a village / town / PIN code. The value carries the full address:
// { lat, lon, city (short label), village, subDistrict, district, state, pincode }.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, MapPin } from 'lucide-react';
import PlaceSearch, { reverseAddress, shortLabel } from './PlaceSearch';
import { Button, ErrorAlert, Notice } from './ui';

export const placeName = (loc) =>
  loc?.city || (loc ? shortLabel(loc) || `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}` : '');

const ADDRESS_KEYS = ['village', 'subDistrict', 'district', 'state', 'pincode'];

export function AddressSummary({ value }) {
  const { t } = useTranslation();
  const rows = ADDRESS_KEYS.filter((k) => value?.[k]);
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl bg-mint p-3 text-sm ring-1 ring-line">
      {rows.map((k) => (
        <div key={k} className={k === 'subDistrict' ? 'col-span-2 sm:col-span-1' : ''}>
          <dt className="text-xs text-ink-muted">{t(`places.${k}`)}</dt>
          <dd className="font-medium text-ink">{value[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function LocationPicker({ value, onChange }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const useGeolocation = () => {
    setError('');
    if (!('geolocation' in navigator)) return setError(t('profile.geoUnsupported'));
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(5));
        const lon = Number(pos.coords.longitude.toFixed(5));
        const addr = await reverseAddress(lat, lon); // null if the lookup fails: coordinates alone still work
        const place = { lat, lon, ...(addr ? Object.fromEntries(ADDRESS_KEYS.filter((k) => addr[k]).map((k) => [k, addr[k]])) : {}) };
        onChange({ ...place, city: shortLabel(place) });
        setBusy(false);
      },
      () => { setBusy(false); setError(t('profile.geoDenied')); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-ink-soft">
        <MapPin className="size-5 shrink-0 text-brand-700" aria-hidden />
        {value ? t('profile.current', { place: placeName(value) }) : t('profile.noLocation')}
      </p>
      <AddressSummary value={value} />
      {value?.approximate && <Notice tone="warning">{t('places.approximate')}</Notice>}
      <Button type="button" variant="secondary" onClick={useGeolocation} loading={busy} className="w-full">
        {!busy && <Crosshair className="size-5" aria-hidden />}
        {busy ? t('profile.locating') : t('profile.useMyLocation')}
      </Button>
      <PlaceSearch onSelect={(place) => { setError(''); onChange(place); }} />
      <ErrorAlert message={error} />
      <p className="text-xs text-ink-muted">{t('places.attribution')}</p>
    </div>
  );
}
