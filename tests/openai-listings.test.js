import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSuggestions, lookupListing } from '../server/openai-listings.js';
import { listingLink } from '../src/listings.js';

const url = 'https://www.zillow.com/homedetails/798123_zpid/';
const otherUrl = 'https://www.zillow.com/homedetails/798124_zpid/';
const photo = 'https://photos.zillowstatic.com/apartment.jpg';

function searchResponse(data, sources, images = []) {
  return Response.json({
    status: 'completed',
    output: [
      { type: 'web_search_call', action: { sources: sources.map(url => ({ url })) }, results: images },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] },
    ],
  });
}

test('autofill uses details and images grounded in the exact listing', async () => {
  const data = { bedrooms: 0, bathrooms: 1.5, square_feet: 720, main_photo: photo };
  const listedImage = { type: 'image_result', image_url: photo, source_website_url: url };
  const matched = await lookupListing(listingLink(url + '?tracking=private'), async (endpoint, options) => {
    assert.equal(endpoint, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.doesNotMatch(body.input, /tracking=private/);
    return searchResponse(data, [url], [listedImage]);
  });
  assert.equal(matched.bedrooms, 0);
  assert.equal(matched.bathrooms, 1.5);
  assert.equal(matched.square_feet, 720);
  assert.equal(matched.image_url, photo);

  const mismatched = await lookupListing(listingLink(url), async () => searchResponse(data, [otherUrl], [
    { ...listedImage, source_website_url: otherUrl },
  ]));
  assert.deepEqual(mismatched, {});
});

test('suggestions require an active, sourced unit within saved preferences', async () => {
  const valid = { url, active_rental: true, monthly_rent: 2900, bedrooms: 1, neighborhood: 'Fort Greene' };
  const matches = await findSuggestions({ max_rent: 3200, min_bedrooms: 1, neighborhoods: ['Fort Greene'] },
    async () => searchResponse({ matches: [
      valid,
      { ...valid, url: otherUrl, monthly_rent: 3400 },
      { ...valid, url: 'https://streeteasy.com/rental/1111111' },
    ] }, [url, otherUrl]));
  assert.deepEqual(matches.map(listing => [listing.url, listing.status]), [[url, 'suggested']]);
});
