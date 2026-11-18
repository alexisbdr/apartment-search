import { createClient } from '@supabase/supabase-js';
import { isScheduled } from '../server/scheduled.js';
import { isCleanupHour, scanListingAvailability } from '../server/listing-availability.js';

export async function GET(request) {
  const { CRON_SECRET, VITE_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const headers = { 'Cache-Control': 'no-store' };
  if (!isScheduled(request, CRON_SECRET)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers });
  }
  const key = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!VITE_SUPABASE_URL || !key) {
    return Response.json({ error: 'Availability checks are not configured' }, { status: 503, headers });
  }
  const now = new Date();
  if (!isCleanupHour(now)) return Response.json({ outsideCleanupHour: true }, { headers });

  try {
    const db = createClient(VITE_SUPABASE_URL, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: (url, options = {}) => fetch(url, {
          ...options,
          signal: AbortSignal.any([AbortSignal.timeout(10000), ...[options.signal].filter(Boolean)]),
        }),
      },
    });
    const result = await scanListingAvailability(db, { now });
    return Response.json(result, { status: result.failed || result.remaining ? 503 : 200, headers });
  } catch (error) {
    console.error('Availability scan failed', error.code ?? error.message);
    return Response.json({ error: 'Availability scan failed' }, { status: 502, headers });
  }
}
