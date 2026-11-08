import { timingSafeEqual } from 'node:crypto';
/** A scheduler token must never authorize fleet/queue/admin actions. */
export function ariaSchedulerAuthorized(job: string, supplied: string, expected: string | undefined) {
  if (job !== 'aria' || !supplied || !expected) return false;
  const a = Buffer.from(supplied), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a,b);
}
