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

test('daily search learns from saved apartments and prioritizes stronger interest', async () => {
  const history = [
    { status: 'interested', neighborhood: 'Clinton Hill', monthly_rent: 2800, bedrooms: 0,
      notes: 'Private viewing notes', street_address: 'Private address', url: 'https://example.com/private' },
    { status: 'visited', neighborhood: 'Fort Greene', bathrooms: 1.5, square_feet: 800 },
    { status: 'applied', neighborhood: 'Prospect Heights', monthly_rent: 3100 },
    { status: 'contacted', neighborhood: 'Bed-Stuy', bedrooms: 1 },
    { status: 'denied', neighborhood: 'Denied example' },
    { status: 'suggested', neighborhood: 'Unaccepted example' },
    { status: 'applied', neighborhood: 'Trashed example', trashed_at: '2026-11-18T00:00:00Z' },
    { status: 'interested' },
  ];
  await findSuggestions({ max_rent: 3200, min_bedrooms: 0, neighborhoods: ['Fort Greene'] },
    async (_endpoint, options) => {
      const { input } = JSON.parse(options.body);
      const examples = JSON.parse(input.split('provided as reference data: ')[1].split('. Use these examples')[0]);
      assert.deepEqual(examples.map(example => example.interest_weight), [4, 3, 2, 1]);
      assert.equal(examples[1].bathrooms, 1.5);
      assert.equal(examples[1].square_feet, 800);
      assert.equal(examples[3].bedrooms, 0);
      assert.equal(examples[3].bathrooms, null);
      assert.doesNotMatch(input, /Private viewing notes|Private address|example.com|Denied example|Unaccepted example|Trashed example/);
      assert.match(input, /mandatory filters/);
      return searchResponse({ matches: [] }, []);
    }, history);
});

test('daily search caps preference examples and uses recent examples within a stage', async () => {
  const history = Array.from({ length: 30 }, (_, day) => ({
    status: 'interested',
    neighborhood: 'Example ' + day,
    updated_at: new Date(Date.UTC(2026, 9, day + 1)).toISOString(),
  }));
  history.push({ status: 'applied', neighborhood: 'Older application', updated_at: '2020-01-01T00:00:00Z' });
  await findSuggestions({ max_rent: 3200, min_bedrooms: 0, neighborhoods: ['Fort Greene'] },
    async (_endpoint, options) => {
      const { input } = JSON.parse(options.body);
      const examples = JSON.parse(input.split('provided as reference data: ')[1].split('. Use these examples')[0]);
      assert.equal(examples.length, 24);
      assert.equal(examples[0].neighborhood, 'Older application');
      assert.equal(examples[1].neighborhood, 'Example 29');
      assert.equal(examples.at(-1).neighborhood, 'Example 7');
      return searchResponse({ matches: [] }, []);
    }, history);
});

test('daily search excludes previously saved listings, including trash and suggestions', async () => {
  const valid = { active_rental: true, monthly_rent: 2900, bedrooms: 1, neighborhood: 'Fort Greene' };
  const trashUrl = 'https://streeteasy.com/rental/1111111';
  const freshUrl = 'https://streeteasy.com/rental/2222222';
  const sources = [url, otherUrl, trashUrl, freshUrl];
  const history = [
    { ...listingLink(url), status: 'visited' },
    { ...listingLink(otherUrl), status: 'suggested' },
    { ...listingLink(trashUrl), status: 'interested', trashed_at: '2026-11-18T00:00:00Z' },
  ];
  const matches = await findSuggestions({ max_rent: 3200, min_bedrooms: 1, neighborhoods: ['Fort Greene'] },
    async () => searchResponse({ matches: sources.map(url => ({ ...valid, url })) }, sources), history);
  assert.deepEqual(matches.map(listing => listing.url), [freshUrl]);
});
