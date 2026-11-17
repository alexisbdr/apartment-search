import { useCallback, useEffect, useRef, useState } from 'react';

export function useBoard(store) {
  const [listings, setListings] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [pending, setPending] = useState(false);
  const refreshId = useRef(0);
  const mutating = useRef(false);

  const refresh = useCallback(async () => {
    if (mutating.current) return;
    const id = ++refreshId.current;
    try {
      const rows = await store.list();
      if (id !== refreshId.current) return;
      setListings(rows);
      setLoaded(true);
      setLoadError('');
    } catch (error) {
      if (id === refreshId.current) setLoadError(error.message);
    }
  }, [store]);

  useEffect(() => {
    refresh();
    window.addEventListener('focus', refresh);
    const unsubscribe = store.subscribe(refresh);
    return () => {
      refreshId.current += 1;
      window.removeEventListener('focus', refresh);
      unsubscribe();
    };
  }, [store, refresh]);

  async function mutate(operation, apply) {
    if (mutating.current) throw new Error('A change is already being saved.');
    mutating.current = true;
    refreshId.current += 1;
    setPending(true);
    try {
      const result = await operation();
      setListings(rows => apply(rows, result));
    } finally {
      mutating.current = false;
      setPending(false);
      void refresh();
    }
  }

  return { listings, loaded, loadError, pending, refresh, mutate, store };
}
