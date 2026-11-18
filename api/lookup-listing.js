import { createClient } from '@supabase/supabase-js';
import { listingLink } from '../src/listings.js';
import { lookupListing } from '../server/openai-listings.js';

function result(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return result({ error: 'Sign in to look up listing details.' }, 401);

  const { VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, OPENAI_API_KEY } = process.env;
  if (!VITE_SUPABASE_URL || !VITE_SUPABASE_PUBLISHABLE_KEY || !OPENAI_API_KEY) {
    return result({ error: 'Automatic lookup is unavailable until the OpenAI API key is configured.' }, 503);
  }

  let link;
  try {
    const body = await request.json();
    link = listingLink(body.url);
  } catch {
    return result({ error: 'Use an individual StreetEasy or Zillow listing link.' }, 400);
  }

  try {
    const client = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !user) return result({ error: 'Sign in again to look up listing details.' }, 401);
    const { data: member, error: membershipError } = await client.from('board_members')
      .select('user_id').eq('user_id', user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!member) return result({ error: 'Listing lookup is available to board members.' }, 403);

    const { data: allowed, error } = await client.rpc('claim_listing_lookup');
    if (error) throw error;
    if (!allowed) return result({ error: 'You’ve reached today’s lookup limit. You can still add the details by hand.' }, 429);
    return result(await lookupListing(link));
  } catch (error) {
    console.error('Listing lookup failed', error.code ?? error.message);
    return result({ error: 'Couldn’t look up this listing. Try again or enter the details by hand.' }, 502);
  }
}
