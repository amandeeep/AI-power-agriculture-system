// Numeric input with range validation and a "typical range" hint. Uses the decimal keypad on phones.
import { useTranslation } from 'react-i18next';
import { RANGES } from '../lib/constants';
import { Field, inputClass } from './ui';

/** Returns an error message or '' for a value against RANGES[name]. */
export function rangeError(name, value, t, { required = true } = {}) {
  const r = RANGES[name];
  if (value === '' || value === null || value === undefined) return required ? t('common.required') : '';
  const n = Number(value);
  if (Number.isNaN(n) || n < r.min || n > r.max) return t('common.outOfRange', { min: r.min, max: r.max });
  return '';
}

export default function NumberField({ name, label, value, onChange, error, required = true }) {
  const { t } = useTranslation();
  const r = RANGES[name];
  const id = `f-${name}`;
  return (
    <Field id={id} label={`${label}${r.unit ? ` (${r.unit})` : ''}`} error={error} hint={t('common.typical', { range: r.typical })} optional={!required} optionalLabel={t('common.optional')}>
      <input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        min={r.min}
        max={r.max}
        step={r.step}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className={inputClass}
      />
    </Field>
  );
}
