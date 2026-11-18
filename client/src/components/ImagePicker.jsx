// Leaf photo picker with preview. On phones `capture` opens the camera directly.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, X } from 'lucide-react';
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from '../lib/constants';

/** Returns an error message key, or null if the file is acceptable. */
export function validateImage(file) {
  if (!IMAGE_TYPES.includes(file.type)) return 'disease.badType';
  if (file.size > MAX_IMAGE_BYTES) return 'disease.tooBig';
  return null;
}

export default function ImagePicker({ file, onChange, onError }) {
  const { t } = useTranslation();
  const inputRef = useRef(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!f) return;
    const err = validateImage(f);
    if (err) return onError?.(t(err));
    onError?.('');
    onChange(f);
  };

  return (
    <div>
      <input ref={inputRef} type="file" accept={IMAGE_TYPES.join(',')} capture="environment" className="sr-only" id="leaf-photo" onChange={pick} />
      {preview ? (
        <div className="relative overflow-hidden rounded-2xl bg-slate-100 ring-1 ring-line">
          <img src={preview} alt={t('chat.photo')} className="mx-auto max-h-80 w-full object-contain" />
          <button type="button" onClick={() => onChange(null)} className="absolute right-2 top-2 grid size-11 place-items-center rounded-full bg-black/60 text-white" aria-label={t('chat.removeImage')}>
            <X className="size-5" />
          </button>
          <label htmlFor="leaf-photo" className="absolute bottom-2 left-2 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-white/90 px-3 font-semibold text-brand-800 shadow">
            <Camera className="size-5" aria-hidden />{t('disease.change')}
          </label>
        </div>
      ) : (
        <label htmlFor="leaf-photo" className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-brand-500/50 bg-brand-50 p-6 text-center text-brand-800 hover:bg-brand-100">
          <Camera className="size-10" aria-hidden />
          <span className="text-lg font-semibold">{t('disease.choose')}</span>
          <span className="text-sm text-ink-soft">{t('disease.fileHint')}</span>
        </label>
      )}
    </div>
  );
}
