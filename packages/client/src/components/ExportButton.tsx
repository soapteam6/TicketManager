import { useState } from 'react';
import { api, apiErrorMessage } from '@/lib/api';
import { Button } from './Button';

// Downloads the season tracker xlsx. Because the endpoint requires the Bearer
// token, we fetch it as a blob through the authed axios instance rather than a
// bare <a href>, then trigger a client-side download.
export function ExportButton({ seasonId, label = 'Export to Excel' }: { seasonId?: number; label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/season.xlsx', {
        params: seasonId ? { seasonId } : undefined,
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ais-season-tracker.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiErrorMessage(err, 'Export failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-600">{error}</span>}
      <Button variant="secondary" size="sm" loading={loading} onClick={download}>
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
        </svg>
        {label}
      </Button>
    </div>
  );
}
