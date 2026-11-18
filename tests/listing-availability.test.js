import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkListingAvailability, cleanupDay, isCleanupHour, pageAvailability, scanListingAvailability,
} from '../server/listing-availability.js';
import { isScheduled } from '../server/scheduled.js';

const url = 'https://streeteasy.com/rental/1234567';
const updatedAt = '2026-11-18T20:00:00Z';
const now = new Date('2026-11-19T07:15:00Z');

function offerPage(url, availability) {
  return '<script type="application/ld+json">' +
    JSON.stringify({ '@type': 'RealEstateListing', url, offers: { availability } }) + '</script>';
}

test('cleanup runs once in the Pacific evening through daylight saving time', () => {
  assert.equal(isCleanupHour(now), true);
  assert.equal(cleanupDay(now), '2026-11-18');
  assert.equal(isCleanupHour(new Date('2026-11-19T06:15:00Z')), false);
  assert.equal(isCleanupHour(new Date('2026-07-19T06:15:00Z')), true);
  assert.equal(isCleanupHour(new Date('2026-07-19T07:15:00Z')), false);
});

test('missing pages and explicit removal headings confirm a removal', () => {
  assert.equal(pageAvailability('', 410, url).status, 'removed');
  assert.equal(pageAvailability('<h1>Page not found</h1>', 404, url).status, 'removed');
  assert.equal(pageAvailability('<h1>This listing is no longer available.</h1>', 200, url).status, 'removed');
  assert.equal(pageAvailability('<title>Listing removed | StreetEasy</title>', 200, url).status, 'removed');
});

test('blocks, related listings, conflicting signals and unclear pages stay unconfirmed', () => {
  for (const [html, status] of [
    ['<title>Security check</title><h1>Page not found</h1>', 404],
    ['<title>Press &amp; Hold</title>', 200],
    ['<h1>This listing is no longer available</h1>', 403],
    ['<h1>Temporary server error</h1>', 503],
    ['<p>Similar listings are no longer available.</p>', 200],
    ['<script>const banner = "<h1>This listing is no longer available</h1>"</script>', 200],
    [offerPage('https://streeteasy.com/rental/7654321', 'https://schema.org/OutOfStock'), 200],
    [offerPage(url, 'https://schema.org/InStock') + '<h1>This listing is no longer available</h1>', 200],
  ]) assert.equal(pageAvailability(html, status, url).status, 'unknown');
  assert.equal(pageAvailability(offerPage(url, 'https://schema.org/InStock'), 200, url).status, 'active');
  assert.equal(pageAvailability(offerPage(url, 'https://schema.org/OutOfStock'), 200, url).status, 'removed');
});

test('StreetEasy nested offers are matched to the current unit and ignore other units and history', () => {
  const html = '<script type="application/ld+json">' + JSON.stringify({
    '@graph': [{
      '@type': 'ItemPage',
      about: {
        '@type': 'RealEstateListing',
        offers: { url, availability: 'https://schema.org/InStock' },
      },
    }, {
      '@type': 'RealEstateListing',
      offers: { url: 'https://streeteasy.com/rental/7654321', availability: 'https://schema.org/OutOfStock' },
    }],
  }) + '</script><p>Price history — No longer available — 2015</p>';
  assert.equal(pageAvailability(html, 200, url).status, 'active');
  assert.equal(pageAvailability(html.replace('InStock', 'OutOfStock'), 200, url).status, 'removed');
});

test('provider requests allow redirects only to the same listing', async () => {
  const visited = [];
  const result = await checkListingAvailability(url, async (target, options) => {
    visited.push(target);
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://example.com/private' } });
  });
  assert.equal(result.status, 'unknown');
  assert.deepEqual(visited, [url]);

  const available = await checkListingAvailability(url, async target => target === url
    ? new Response(null, { status: 302, headers: { Location: url + '/' } })
    : new Response(offerPage(url, 'https://schema.org/InStock')));
  assert.equal(available.status, 'active');
});

test('provider timeouts and invalid or oversized responses preserve listings', async () => {
  const unavailable = await checkListingAvailability(url, async () => { throw new Error('timeout'); });
  assert.equal(unavailable.status, 'unknown');
  const invalid = await checkListingAvailability('https://example.com/private', () => assert.fail('Unexpected request'));
  assert.equal(invalid.status, 'unknown');
  const oversized = await checkListingAvailability(url, async () => new Response('x'.repeat(2000001), { status: 404 }));
  assert.equal(oversized.status, 'unknown');
});

function fakeDatabase(rows) {
  return {
    from(table) {
      assert.equal(table, 'listings');
      return {
        select() {
          return {
            is() { return this; },
            order() { return this; },
            async range(start, end) {
              return { data: rows.filter(row => !row.trashed_at).slice(start, end + 1).map(row => ({ ...row })) };
            },
          };
        },
        update(changes) {
          const filters = {};
          return {
            eq(name, value) { filters[name] = value; return this; },
            is(name, value) { filters[name] = value; return this; },
            select() { return this; },
            async maybeSingle() {
              const row = rows.find(row => row.id === filters.id && row.updated_at === filters.updated_at &&
                (row.trashed_at ?? null) === filters.trashed_at);
              if (!row) return { data: null };
              Object.assign(row, changes, { updated_at: now.toISOString() });
              return { data: { id: row.id } };
            },
          };
        },
      };
    },
  };
}

test('scan archives confirmed removals, keeps stage and notes, and skips completed checks', async () => {
  const rows = [
    { id: '1', url, status: 'visited', notes: 'Viewing notes', updated_at: updatedAt },
    { id: '2', url: url.replace('1234567', '2234567'), status: 'suggested', updated_at: updatedAt },
    { id: '3', url, status: 'applied', updated_at: updatedAt, availability_checked_at: now.toISOString() },
    { id: '4', url, trashed_at: updatedAt, updated_at: updatedAt },
  ];
  const db = fakeDatabase(rows);
  let requests = 0;
  const request = async target => {
    requests += 1;
    return target === url ? new Response('Page not found', { status: 404 })
      : new Response('<title>Access denied</title>', { status: 403 });
  };
  const result = await scanListingAvailability(db, { now, request });
  assert.equal(result.checked, 2);
  assert.equal(result.removed, 1);
  assert.equal(result.unknown, 1);
  assert.equal(rows[0].trashed_at, now.toISOString());
  assert.equal(rows[0].status, 'visited');
  assert.equal(rows[0].notes, 'Viewing notes');
  assert.equal(rows[1].trashed_at, undefined);
  assert.equal(rows[1].availability_status, 'unknown');
  await scanListingAvailability(db, { now, request });
  assert.equal(requests, 2);
});

test('a concurrent edit or restore takes precedence over a removal result', async () => {
  const row = { id: '1', url, status: 'interested', updated_at: updatedAt };
  const result = await scanListingAvailability(fakeDatabase([row]), {
    now,
    request: async () => {
      row.status = 'visited';
      row.updated_at = '2026-11-19T07:15:01Z';
      return new Response('', { status: 410 });
    },
  });
  assert.equal(result.conflicts, 1);
  assert.equal(result.removed, 0);
  assert.equal(row.trashed_at, undefined);
  assert.equal(row.status, 'visited');
});

test('scheduled endpoint authorization requires the configured secret', () => {
  assert.equal(isScheduled(new Request('https://example.com'), ''), false);
  assert.equal(isScheduled(new Request('https://example.com', { headers: { Authorization: 'Bearer wrong' } }), 'secret'), false);
  assert.equal(isScheduled(new Request('https://example.com', { headers: { Authorization: 'Bearer secret' } }), 'secret'), true);
});
