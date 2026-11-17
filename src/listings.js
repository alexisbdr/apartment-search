export const stages = [
  { key: 'interested', label: 'Interested', statuses: ['interested'] },
  { key: 'contacted', label: 'Contacted', statuses: ['contacted'] },
  { key: 'applications', label: 'Applied / Denied', statuses: ['applied', 'denied'] },
];

export const statuses = [
  ['interested', 'Interested'],
  ['contacted', 'Contacted'],
  ['applied', 'Applied'],
  ['denied', 'Denied'],
];

export const providers = { streeteasy: 'StreetEasy', zillow: 'Zillow' };

const formats = 'Paste a link to an individual StreetEasy or Zillow listing.';

export function listingLink(input) {
  const value = String(input ?? '').trim();
  if (!value || value.length > 2048) throw new Error(formats);

  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
  } catch {
    throw new Error(formats);
  }

  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error(formats);
  }

  const path = url.pathname.replace(/\/+$/, '');
  const host = url.hostname;
  if (host === 'streeteasy.com' || host === 'www.streeteasy.com') {
    const rental = path.match(/^\/rental\/(\d+)$/i);
    const unit = path.match(/^\/building\/([^/]+)\/([^/]+)$/i);
    if (!rental && !unit) throw new Error(formats);

    return {
      source: 'streeteasy',
      source_key: rental ? 'rental:' + rental[1] : 'unit:' + (unit[1] + '/' + unit[2]).toLowerCase(),
      url: 'https://streeteasy.com' + path,
    };
  }

  if (!['zillow.com', 'www.zillow.com', 'm.zillow.com'].includes(host)) throw new Error(formats);

  const home = path.match(/^\/homedetails\/(?:[^/]+\/)?(\d+)_zpid$/i);
  const apartment = path.match(/^\/apartments\/[^/]+\/[^/]+\/([a-z\d]+)$/i);
  const olderBuilding = path.match(/^\/b\/([^/]+)$/i);
  if (!home && !apartment && !olderBuilding) throw new Error(formats);

  const query = new URLSearchParams();
  for (const [key, value] of url.searchParams) {
    if (!/^(utm_|gclid$|fbclid$|mmlb$)/i.test(key)) query.append(key, value);
  }
  query.sort();

  // A building link can describe multiple units. Keep its unit parameter when present.
  const unit = [...query.entries()].find(([key]) => /^(unit|unitid|unitnumber|unit_id)$/i.test(key));
  const building = apartment ? apartment[1] : olderBuilding?.[1];
  const sourceKey = home ? 'home:' + home[1] : 'building:' + building + (unit ? ':' + unit[1] : '');

  return {
    source: 'zillow',
    source_key: sourceKey,
    url: 'https://www.zillow.com' + path + '/' + (query.size ? '?' + query.toString() : ''),
  };
}

function optionalInteger(fields, name, label, max) {
  const value = String(fields.get(name) ?? '').trim();
  if (!value) return null;
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(number) || number > max) {
    throw new Error(label + ' must be a whole number between 0 and ' + max + '.');
  }
  return number;
}

export function listingDraft(fields) {
  const link = listingLink(fields.get('url'));
  return {
    ...link,
    title: String(fields.get('title') ?? '').trim(),
    neighborhood: String(fields.get('neighborhood') ?? '').trim(),
    monthly_rent: optionalInteger(fields, 'monthly_rent', 'Monthly rent', 1000000),
    bedrooms: optionalInteger(fields, 'bedrooms', 'Bedrooms', 30),
    notes: String(fields.get('notes') ?? '').trim(),
  };
}

export function listingTitle(listing) {
  if (listing.title) return listing.title;
  const path = new URL(listing.url).pathname.split('/').filter(Boolean);
  const slug = listing.source === 'streeteasy' && path[0] === 'building' ? path[1]
    : path[0] === 'homedetails' && path.length > 2 ? path[1]
    : path[0] === 'apartments' ? path[2]
    : '';
  if (!slug) return providers[listing.source] + ' listing';

  const display = slug.replace(/-/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase());
  return listing.source === 'streeteasy' ? display + ' #' + path[2] : display;
}

export function conflictError() {
  return new Error('This listing changed in another session. Close and reopen it to review the latest version.');
}

export function duplicateError() {
  return new Error('That listing is already on the board.');
}
