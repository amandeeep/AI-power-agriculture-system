// Type-ahead search for an Indian village / town / city, or a 6-digit PIN code (accessible combobox).
// Names: GET /api/places/search (OpenStreetMap). PIN: GET /api/places/pincode/:pin (India Post).
// Picking a result resolves the full address, including the district, through resolvePlace().
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MapPin, Search } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { inputClass } from './ui';

const PIN_RE = /^[1-9]\d{5}$/;
const DEBOUNCE_MS = 350;

/** Short display label stored as `city` (the server caps it at 100 characters). */
export function shortLabel(p) {
  const parts = [p.village, p.district, p.state].filter(Boolean);
  const unique = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  return unique.join(', ').slice(0, 100) || undefined;
}

/** Coordinates -> full address (village, mandal/taluk, district, state, PIN). Never throws. */
export async function reverseAddress(lat, lon) {
  try {
    const { data } = await api.get('/places/reverse', { params: { lat, lon } });
    return data.place;
  } catch {
    return null;
  }
}

/**
 * Turns a picked suggestion into the location object saved on the profile / a field:
 * { lat, lon, city, village, subDistrict, district, state, pincode }.
 * Name suggestions get the district from reverse geocoding (the search service rarely has it);
 * PIN post offices have no coordinates, so they are looked up by name within their district.
 */
export async function resolvePlace(item) {
  let { lat, lon } = item;
  let approximate = false;
  if (lat == null) {
    // Post offices have no coordinates. Name search is fuzzy and can hit a same-named village in
    // another state, so each attempt must be verified: same PIN, else same state, else the district centre.
    const sameState = (r) => r.state && item.state && r.state.toLowerCase() === item.state.toLowerCase();
    const attempts = [
      [item.name, (r) => r.pincode === item.pincode],
      [`${item.name} ${item.district}`, sameState],
      [`${item.district} ${item.state}`, sameState, true],
    ];
    for (const [q, ok, coarse] of attempts) {
      const { data } = await api.get('/places/search', { params: { q } });
      const hit = data.results.find(ok);
      if (hit) { ({ lat, lon } = hit); approximate = Boolean(coarse); break; }
    }
    if (lat == null) return null;
  }
  const rev = item.fromPin ? null : await reverseAddress(lat, lon);
  const place = {
    lat,
    lon,
    village: item.name ?? rev?.village,
    subDistrict: item.subDistrict ?? rev?.subDistrict,
    district: item.district ?? rev?.district,
    state: item.state ?? rev?.state,
    pincode: item.pincode ?? rev?.pincode,
  };
  return {
    ...Object.fromEntries(Object.entries(place).filter(([, v]) => v != null && v !== '')),
    city: shortLabel(place),
    ...(approximate ? { approximate: true } : {}), // map point = district centre (UI only, not saved)
  };
}

export default function PlaceSearch({ onSelect, disabled = false }) {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [items, setItems] = useState([]);
  const [heading, setHeading] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reqId = useRef(0);
  const boxRef = useRef(null);

  // Debounced lookup; a newer keystroke makes older responses irrelevant (reqId).
  useEffect(() => {
    const q = text.trim();
    setMessage('');
    if (q.length < 3 && !PIN_RE.test(q)) { setItems([]); setOpen(false); return undefined; }
    if (/^\d+$/.test(q) && !PIN_RE.test(q)) { setItems([]); setOpen(false); return undefined; } // PIN still being typed
    const my = ++reqId.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        if (PIN_RE.test(q)) {
          const { data } = await api.get(`/places/pincode/${q}`);
          if (my !== reqId.current) return;
          setHeading(t('places.pinOffices', { pin: q }));
          setItems(data.offices.map((o) => ({ ...o, fromPin: true })));
        } else {
          const { data } = await api.get('/places/search', { params: { q } });
          if (my !== reqId.current) return;
          setHeading('');
          setItems(data.results);
          if (!data.results.length) setMessage(t('places.noMatches'));
        }
        setOpen(true);
        setActive(-1);
      } catch (err) {
        if (my !== reqId.current) return;
        setItems([]);
        setOpen(false);
        setMessage(err?.response?.status === 404 ? t('places.pinNotFound') : errorMessage(err, t));
      } finally {
        if (my === reqId.current) setBusy(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, t]);

  // Close the list when clicking elsewhere.
  useEffect(() => {
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const choose = async (item) => {
    setOpen(false);
    setBusy(true);
    setMessage(t('places.fillingAddress'));
    reqId.current += 1; // ignore any lookup still in flight
    try {
      const place = await resolvePlace(item);
      if (!place) { setMessage(t('places.notOnMap')); return; }
      setText('');
      setItems([]);
      setMessage('');
      onSelect(place);
    } catch (err) {
      setMessage(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e) => {
    if (!open || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a <= 0 ? items.length - 1 : a - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { setOpen(false); }
  };

  const listId = `${id}-list`;
  return (
    <div ref={boxRef} className="relative">
      <label htmlFor={`${id}-input`} className="mb-1 block font-medium text-ink-soft">{t('places.searchLabel')}</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-muted" aria-hidden />
        <input
          id={`${id}-input`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          inputMode="search"
          className={`${inputClass} pl-10 pr-10`}
          placeholder={t('places.placeholder')}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => items.length && setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {busy && <Loader2 className="absolute right-3 top-1/2 size-5 -translate-y-1/2 animate-spin text-brand-700" aria-label={t('places.searching')} />}
      </div>

      {open && items.length > 0 && (
        <ul id={listId} role="listbox" aria-label={heading || t('places.searchLabel')}
          className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
          {heading && <li role="presentation" className="px-3 py-1.5 text-xs font-semibold text-ink-muted">{heading}</li>}
          {items.map((item, i) => (
            <li
              key={`${item.label}-${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onPointerDown={(e) => e.preventDefault()} // keep focus in the input
              onClick={() => choose(item)}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-12 cursor-pointer items-start gap-2 px-3 py-2 ${i === active ? 'bg-brand-50' : ''}`}
            >
              <MapPin className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden />
              <span>
                <span className="block font-semibold text-ink">{item.name}</span>
                <span className="block text-sm text-ink-soft">
                  {[item.subDistrict, item.district, item.state].filter(Boolean).join(', ')}{item.pincode ? ` · ${item.pincode}` : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="mt-1 min-h-5 text-sm text-ink-soft">{message}</p>
    </div>
  );
}
