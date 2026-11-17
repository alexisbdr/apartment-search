import { listingLink } from './listings.js';

const mapBounds = { west: -74.013, east: -73.919, south: 40.636, north: 40.739 };
const geosearch = 'https://geosearch.planninglabs.nyc/v2/search';

const streetTypes = {
  st: 'street', ave: 'avenue', av: 'avenue', blvd: 'boulevard', pl: 'place', rd: 'road',
  pkwy: 'parkway', ter: 'terrace', ct: 'court', ln: 'lane', dr: 'drive', cir: 'circle',
  e: 'east', w: 'west', n: 'north', s: 'south',
};
const streetEnd = /\b(?:street|st|avenue|ave|av|boulevard|blvd|place|pl|road|rd|parkway|pkwy|terrace|ter|court|ct|lane|ln|drive|dr|way|circle|cir)\b/gi;

export function isMapped(listing) {
  const { longitude, latitude } = listing;
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    && longitude >= mapBounds.west && longitude <= mapBounds.east
    && latitude >= mapBounds.south && latitude <= mapBounds.north;
}

export function addressFromLink(value) {
  try {
    const { url, source } = listingLink(value);
    const parts = new URL(url).pathname.split('/');
    const slug = source === 'streeteasy' && parts[1] === 'building' ? parts[2]
      : parts[1] === 'homedetails' && parts[3] ? parts[2]
      : parts[1] === 'apartments' ? parts[3]
      : parts[1] === 'b' ? parts[2] : '';
    const address = decodeURIComponent(slug).replace(/-/g, ' ');
    const ending = [...address.matchAll(streetEnd)].at(-1);
    if (!/^\d+\s+\S/.test(address) || !ending) return '';
    return address.slice(0, ending.index + ending[0].length)
      .replace(/\b[a-z]/g, letter => letter.toUpperCase());
  } catch {
    return '';
  }
}

function streetAddressOnly(address) {
  return address.replace(/[,\s]+(?:apt\.?|unit|apartment|suite|#)\s*.*$/i, '').split(',')[0].trim();
}

function equivalentStreet(street) {
  return street.toLowerCase().replace(/[.]/g, '').trim().split(/\s+/)
    .map((word, index) => word === 'st' && index === 0 ? 'saint' : streetTypes[word] || word)
    .map(word => word.replace(/^(\d+)(st|nd|rd|th)$/, '$1'))
    .join(' ');
}

export function findBrooklynAddress(address, features) {
  const parts = streetAddressOnly(address).match(/^(\d+[a-z]?(?:-\d+[a-z]?)?)\s+(.+)$/i);
  if (!parts || !Array.isArray(features)) return null;
  const [, house, street] = parts;
  const candidates = new Map();

  for (const feature of features) {
    const result = feature?.properties;
    const coords = feature?.geometry?.coordinates;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coords) || coords.length < 2 ||
        result?.borough !== 'Brooklyn' || String(result.housenumber ?? '').toLowerCase() !== house.toLowerCase() ||
        typeof result.street !== 'string' || equivalentStreet(result.street) !== equivalentStreet(street)) continue;
    const [longitude, latitude] = coords;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        longitude < -74.1 || longitude > -73.8 || latitude < 40.55 || latitude > 40.75) continue;
    candidates.set(longitude.toFixed(5) + ',' + latitude.toFixed(5), { longitude, latitude });
  }

  return candidates.size === 1 ? candidates.values().next().value : null;
}

export async function listingLocation(address, previous, fetchAddress = fetch) {
  if (previous?.street_address === address && Number.isFinite(previous.latitude) && Number.isFinite(previous.longitude)) {
    return { latitude: previous.latitude, longitude: previous.longitude };
  }
  const street = streetAddressOnly(address);
  const outsideBrooklyn = /,\s*(?:Manhattan|Queens|Bronx|Staten Island)\b/i.test(address);
  if (!outsideBrooklyn && /^\d+[a-z]?(?:-\d+[a-z]?)?\s+\S/i.test(street)) {
    try {
      const url = new URL(geosearch);
      url.search = new URLSearchParams({ text: street + ', Brooklyn, NY', size: '8' }).toString();
      const response = await fetchAddress(url, {
        signal: AbortSignal.timeout(4500),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      if (response.ok) {
        const result = findBrooklynAddress(street, (await response.json()).features);
        if (result) return result;
      }
    } catch {
      // Keep the listing usable if the address service is unavailable.
    }
  }
  return { latitude: null, longitude: null };
}
