import { timingSafeEqual } from 'node:crypto';

export function isScheduled(request, secret) {
  if (!secret) return false;
  const actual = Buffer.from(request.headers.get('Authorization') ?? '');
  const expected = Buffer.from('Bearer ' + secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
