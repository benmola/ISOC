import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { fetchTodayPrayers, TodayPrayerData } from '../services/masjidboxService';

const CACHE_KEY_PREFIX = 'livePrayers_';

export function useTodayPrayers() {
  const [data, setData] = useState<TodayPrayerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const cacheKey = CACHE_KEY_PREFIX + today;

    // 1. Try localStorage cache first (instant)
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setData(JSON.parse(cached));
        setLoading(false);
        return;
      }
    } catch {
      // Cache miss — continue to fetch
    }

    // 2. Fetch live from masjidbox.com
    let cancelled = false;

    fetchTodayPrayers()
      .then((result) => {
        if (cancelled) return;
        if (result) {
          setData(result);
          // Cache for the rest of the day & clean up old keys
          try {
            for (const key of Object.keys(localStorage)) {
              if (key.startsWith(CACHE_KEY_PREFIX) && key !== cacheKey) {
                localStorage.removeItem(key);
              }
            }
            localStorage.setItem(cacheKey, JSON.stringify(result));
          } catch {
            // localStorage full or unavailable — non-critical
          }
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { data, loading, error };
}
