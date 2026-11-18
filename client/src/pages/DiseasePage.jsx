// Disease check: photo with preview -> POST /api/predict/disease (multipart) -> diagnosis + treatment.
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bug, Info } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import ImagePicker from '../components/ImagePicker';
import DiseaseResults from '../components/results/DiseaseResults';
import { Button, Card, ErrorAlert, Notice, PageHeader } from '../components/ui';

export default function DiseasePage() {
  const { t } = useTranslation();
  const [file, setFile] = useState(null);
  const [pickError, setPickError] = useState('');
  const [state, setState] = useState({ loading: false, error: '', unavailable: false, result: null });
  const resultRef = useRef(null);

  const submit = async () => {
    if (!file) return;
    setState({ loading: true, error: '', unavailable: false, result: null });
    const form = new FormData();
    form.append('image', file);
    try {
      const { data } = await api.post('/predict/disease', form);
      setState({ loading: false, error: '', unavailable: false, result: data });
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      // 503 = the disease model isn't installed/running: say so plainly instead of a raw error.
      const unavailable = err.response?.status === 503;
      setState({ loading: false, error: unavailable ? '' : errorMessage(err, t), unavailable, result: null });
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <div>
        <PageHeader title={t('disease.title')} subtitle={t('disease.subtitle')} />
        <Card>
          <div className="space-y-4">
            <ImagePicker file={file} onChange={(f) => { setFile(f); setState((s) => ({ ...s, result: null })); }} onError={setPickError} />
            <ErrorAlert message={pickError} />
            <Button onClick={submit} disabled={!file} loading={state.loading} className="w-full">
              <Bug className="size-5" aria-hidden />{state.loading ? t('disease.analyzing') : t('disease.submit')}
            </Button>
            <ErrorAlert message={state.error} onRetry={submit} retryLabel={t('common.retry')} />
            {state.unavailable && <Notice tone="warning" icon={Info}>{t('disease.unavailable')}</Notice>}
          </div>
        </Card>
      </div>
      <div ref={resultRef} className="scroll-mt-20 lg:sticky lg:top-20">
        {state.result && <Card><DiseaseResults data={state.result} /></Card>}
      </div>
    </div>
  );
}
