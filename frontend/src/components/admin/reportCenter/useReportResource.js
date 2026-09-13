import { useCallback, useEffect, useState } from 'react';

export default function useReportResource(fetcher, enabled = true) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ data: null, loading: enabled, error: '' });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    if (!enabled) { setState({ data: null, loading: false, error: '' }); return undefined; }
    setState({ data: null, loading: true, error: '' });
    Promise.resolve().then(() => fetcher(controller.signal)).then((data) => {
      if (current) setState({ data, loading: false, error: '' });
    }).catch((error) => {
      if (current && !controller.signal.aborted) setState({ data: null, loading: false, error: error.message || 'Unable to load this section.' });
    });
    return () => { current = false; controller.abort(); };
  }, [fetcher, enabled, revision]);
  const retry = useCallback(() => setRevision((value) => value + 1), []);
  return { ...state, retry };
}
