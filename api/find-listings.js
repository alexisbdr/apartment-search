import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { findSuggestions } from '../server/openai-listings.js';

function isScheduled(request, secret) {
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get('Authorization') ?? '');
  const expected = Buffer.from('Bearer ' + secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request) {
  const { CRON_SECRET, VITE_SUPABASE_URL, OPENAI_API_KEY, SUPABASE_SECRET_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!isScheduled(request, CRON_SECRET)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const key = SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !VITE_SUPABASE_URL || !OPENAI_API_KEY) {
    return Response.json({ error: 'Listing search is not configured' }, { status: 503 });
  }

  try {
    const db = createClient(VITE_SUPABASE_URL, key, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: criteria, error } = await db.from('board_search')
      .select('enabled,neighborhoods,max_rent,min_bedrooms').single();
    if (error) throw error;
    if (!criteria.enabled) return Response.json({ enabled: false });

    const { error: claimError } = await db.from('board_search_runs')
      .insert({ run_day: new Date().toISOString().slice(0, 10) });
    if (claimError?.code === '23505') return Response.json({ alreadyRan: true });
    if (claimError) throw claimError;

    const matches = await findSuggestions(criteria);
    if (!matches.length) return Response.json({ added: 0 });
    const { data: current, error: refreshError } = await db.from('board_search')
      .select('enabled,neighborhoods,max_rent,min_bedrooms').single();
    if (refreshError) throw refreshError;
    if (JSON.stringify(current) !== JSON.stringify(criteria)) return Response.json({ settingsChanged: true });

    const { data: inserted, error: writeError } = await db.from('listings')
      .upsert(matches, { onConflict: 'source,source_key', ignoreDuplicates: true }).select('id');
    if (writeError) throw writeError;
    return Response.json({ added: inserted.length });
  } catch (error) {
    console.error('Scheduled listing search failed', error.code ?? error.message);
    return Response.json({ error: 'Listing search failed' }, { status: 502 });
  }
}
