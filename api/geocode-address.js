import { createClient } from '@supabase/supabase-js';
import { findCensusAddress } from '../src/locations.js';

export async function POST(request) {
  const headers = { 'Cache-Control': 'no-store' };
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return Response.json({ error: 'Sign in to look up an address.' }, { status: 401, headers });
  }
  const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!VITE_SUPABASE_URL || !VITE_SUPABASE_PUBLISHABLE_KEY) {
    return Response.json({ error: 'Address lookup is unavailable.' }, { status: 503, headers });
  }

  let address;
  try {
    const body = await request.json();
    address = typeof body.address === 'string' ? body.address.trim() : '';
    if (!address || address.length > 200) throw new Error('Invalid address');
  } catch {
    return Response.json({ error: 'Use a Brooklyn street address.' }, { status: 400, headers });
  }

  try {
    const client = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !user) return Response.json({ error: 'Sign in again.' }, { status: 401, headers });
    const { data: member, error } = await client.from('board_members')
      .select('user_id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    if (!member) return Response.json({ error: 'Board membership is required.' }, { status: 403, headers });

    const target = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    target.search = new URLSearchParams({
      address: address + ', Brooklyn, NY',
      benchmark: 'Public_AR_Current',
      format: 'json',
    });
    const response = await fetch(target, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Address service failed');
    const data = await response.json();
    return Response.json(findCensusAddress(address, data.result?.addressMatches) ??
      { latitude: null, longitude: null }, { headers });
  } catch {
    return Response.json({ error: 'Address lookup is unavailable.' }, { status: 502, headers });
  }
}
