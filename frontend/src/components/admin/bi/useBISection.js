import { useCallback, useEffect, useState } from 'react';
import { fetchBusinessIntelligence } from '../../../api/adminApi';

export default function useBISection(section, query, refreshKey) {
  const [retryKey, setRetryKey] = useState(0);
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const { period, from, to } = query;
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    // Clear the previous period, so stale financial figures never accompany new dates.
    setState({ data: null, loading: true, error: '' });
    fetchBusinessIntelligence({ section, period, from, to }, controller.signal)
      .then((data) => { if (current) setState({ data, loading: false, error: '' }); })
      .catch((error) => {
        if (current && !controller.signal.aborted) setState({ data: null, loading: false, error: error.message || 'Please try again.' });
      });
    return () => { current = false; controller.abort(); };
  }, [section, period, from, to, refreshKey, retryKey]);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  return { ...state, retry };
}
