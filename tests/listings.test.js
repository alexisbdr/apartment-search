import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listingDraft, listingLink } from '../src/listings.js';
import { browserStore } from '../src/storage.js';

test('StreetEasy links normalize tracking and trailing slashes', () => {
  const clean = listingLink('streeteasy.com/building/sample-brooklyn-building/3a');
  assert.deepEqual(listingLink('https://www.streeteasy.com/building/sample-brooklyn-building/3a/?utm_source=email#tour'), clean);
  assert.equal(listingLink('https://streeteasy.com/rental/1234567').source_key, 'rental:1234567');
});

test('Zillow aliases share the same key while units at the same building stay distinct', () => {
  const original = listingLink('https://www.zillow.com/homedetails/20-Sample-St/798123_zpid/?utm_source=email');
  const other = listingLink('https://m.zillow.com/homedetails/another-slug/798123_zpid/');
  assert.equal(original.source_key, other.source_key);
  assert.equal(new URL(original.url).search, '');
  const building = 'https://www.zillow.com/apartments/brooklyn-ny/example-building/5YKkpW/';
  assert.notEqual(listingLink(building + '?unit=2A').source_key, listingLink(building + '?unit=2B').source_key);
});

test('only individual StreetEasy and Zillow property links are accepted', () => {
  for (const url of [
    'javascript:alert(1)',
    'https://streeteasy.com.evil.example/rental/123',
    'https://www.zillow.com@evil.example/homedetails/798123_zpid/',
    'https://www.zillow.com/brooklyn-new-york-ny/rentals/',
  ]) {
    assert.throws(() => listingLink(url), /individual/);
  }
});

test('optional values stay optional and zero bedrooms means a studio', () => {
  const fields = new URLSearchParams({ url: 'streeteasy.com/rental/1234567', bedrooms: '0', notes: '  Check the walk  ' });
  const row = listingDraft(fields);
  assert.equal(row.bedrooms, 0);
  assert.equal(row.monthly_rent, null);
  assert.equal(row.notes, 'Check the walk');
  fields.set('monthly_rent', '3200.25');
  assert.throws(() => listingDraft(fields), /whole number/);
});

test('browser board persists stages and rejects duplicate and stale writes', async () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  const store = browserStore(storage);
  const draft = listingDraft(new URLSearchParams({ url: 'streeteasy.com/rental/1234567' }));
  const interested = await store.add(draft);
  assert.equal(interested.status, 'interested');
  await assert.rejects(store.add(draft), /already/);
  const contacted = await store.update(interested, { status: 'contacted' });
  assert.equal((await browserStore(storage).list())[0].status, 'contacted');
  await assert.rejects(store.update(interested, { status: 'applied' }), /changed/);
  const applied = await store.update(contacted, { status: 'applied' });
  const denied = await store.update(applied, { status: 'denied' });
  assert.equal((await store.list())[0].status, 'denied');
  await store.remove(denied);
  assert.deepEqual(await store.list(), []);
});
