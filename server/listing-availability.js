import { listingLink } from '../src/listings.js';

export const cleanupTimeZone = 'America/Los_Angeles';
const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: cleanupTimeZone, year: 'numeric', month: '2-digit', day: '2-digit',
});
const hourFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: cleanupTimeZone, hour: 'numeric', hourCycle: 'h23',
});

export function cleanupDay(date) {
  return dayFormat.format(date);
}

export function isCleanupHour(date) {
  return hourFormat.format(date) === '23';
}

function sameListing(first, second) {
  try {
    const a = listingLink(first);
    const b = listingLink(second);
    return a.source === b.source && a.source_key === b.source_key;
  } catch {
    return false;
  }
}

function textContent(html) {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);|&#(?:x[0-9a-f]+|\d+);/gi, entity => {
      const named = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const hex = entity.toLowerCase().startsWith('&#x');
      const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ').trim();
}

function structuredAvailability(html, url) {
  const states = [];
  const scripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const script of scripts) {
    let data;
    try {
      data = JSON.parse(script[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes.flatMap(item => item?.['@graph'] ?? [item])) {
      if (!node || !sameListing(node.url ?? node['@id'], url)) continue;
      const offers = node.offers ? [node.offers].flat() : [node];
      for (const offer of offers) {
        const status = String(offer?.availability ?? '').replace(/^https?:\/\/schema.org\//, '');
        if (['Discontinued', 'OutOfStock', 'SoldOut'].includes(status)) states.push('removed');
        if (['InStock', 'LimitedAvailability', 'PreOrder'].includes(status)) states.push('active');
      }
    }
  }
  return states;
}

export function pageAvailability(html, status, url) {
  const visible = html.replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const text = textContent(visible);
  if (/captcha|access denied|unusual traffic|verify (?:that )?you(?: are|'re) (?:a )?human|press (?:and|&) hold|request (?:was )?blocked|security check|just a moment|pardon (?:our|the) interruption/i.test(text)) {
    return { status: 'unknown', reason: 'The provider blocked the availability check.' };
  }
  if (status === 404 || status === 410) {
    return { status: 'removed', reason: 'The provider returned HTTP ' + status + ' for this listing.' };
  }
  if (status !== 200) {
    return { status: 'unknown', reason: 'The provider returned HTTP ' + status + '.' };
  }

  const states = structuredAvailability(html, url);
  const headings = [...visible.matchAll(/<(title|h1)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(match => textContent(match[2]));
  const removed = headings.find(heading =>
    /^(?:this |the )?(?:listing|rental|apartment|property|home|page) (?:is |has been )?(?:no longer available|no longer listed|removed|not found|unavailable)[.!]?$/i.test(heading) ||
    /^(?:listing removed|listing not found|page not found|this rental is off market|this listing has been rented)[.!]?(?:\s*[|–-].*)?$/i.test(heading));
  if (removed) states.push('removed');
  if (states.includes('active') && states.includes('removed')) {
    return { status: 'unknown', reason: 'The provider shows conflicting availability information.' };
  }
  if (states.includes('removed')) {
    return { status: 'removed', reason: removed?.slice(0, 200) || 'The provider marks this listing as unavailable.' };
  }
  if (states.includes('active')) return { status: 'active', reason: 'The provider marks this listing as available.' };
  return { status: 'unknown', reason: 'The provider page does not expose a clear availability status.' };
}

async function boundedPage(response) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return html + decoder.decode();
      bytes += value.byteLength;
      if (bytes > 2000000) throw new Error('Provider page exceeds the check limit.');
      html += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function checkListingAvailability(input, request = fetch) {
  try {
    const link = listingLink(input);
    const target = new URL(link.url);
    for (const name of [...target.searchParams.keys()]) {
      if (!/^(unit|unitid|unitnumber|unit_id)$/i.test(name)) target.searchParams.delete(name);
    }
    let url = target.href;
    const signal = AbortSignal.timeout(8000);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await request(url, {
        redirect: 'manual', signal, cache: 'no-store',
        headers: { Accept: 'text/html', 'User-Agent': 'BrooklynApartmentSearch/1.0 (saved listing availability check)' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        await response.body?.cancel();
        if (!location) break;
        const next = new URL(location, url);
        if (!sameListing(next.href, link.url) || next.protocol !== 'https:') break;
        url = next.href;
        continue;
      }
      const html = await boundedPage(response);
      return pageAvailability(html, response.status, link.url);
    }
    return { status: 'unknown', reason: 'The provider redirected away from the saved listing.' };
  } catch {
    return { status: 'unknown', reason: 'The listing could not be reached. It will be checked again tomorrow.' };
  }
}

export async function scanListingAvailability(db, { request = fetch, now = new Date(), deadline = Date.now() + 270000 } = {}) {
  const candidates = [];
  const pageSize = 200;
  for (let start = 0; ; start += pageSize) {
    const { data: page, error } = await db.from('listings')
      .select('id,url,updated_at,availability_checked_at')
      .is('trashed_at', null).order('id').range(start, start + pageSize - 1);
    if (error) throw error;
    candidates.push(...page.filter(listing => !listing.availability_checked_at ||
      cleanupDay(new Date(listing.availability_checked_at)) !== cleanupDay(now)));
    if (page.length < pageSize) break;
  }

  const result = { total: candidates.length, checked: 0, removed: 0, unknown: 0, conflicts: 0, failed: 0, remaining: 0 };
  let next = 0;
  async function worker() {
    while (next < candidates.length && Date.now() < deadline) {
      const listing = candidates[next++];
      const outcome = await checkListingAvailability(listing.url, request);
      const changes = {
        availability_status: outcome.status,
        availability_reason: outcome.reason,
        availability_checked_at: now.toISOString(),
        ...(outcome.status === 'removed' && { trashed_at: now.toISOString() }),
      };
      try {
        const { data, error } = await db.from('listings').update(changes)
          .eq('id', listing.id).eq('updated_at', listing.updated_at)
          .is('trashed_at', null).select('id').maybeSingle();
        if (error) throw error;
        if (!data) {
          result.conflicts += 1;
          continue;
        }
        result.checked += 1;
        if (outcome.status === 'removed') result.removed += 1;
        if (outcome.status === 'unknown') result.unknown += 1;
      } catch {
        result.failed += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  result.remaining = candidates.length - next;
  return result;
}
