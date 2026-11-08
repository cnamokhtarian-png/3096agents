/**
 * Signed exchange operations are deny-by-default. This policy applies only to
 * requests through this client; exchange-side API key permissions remain vital.
 */
const ALLOWED = new Set([
  'GET /api/v3/account',
  'POST /api/v3/order',
  'GET /api/v1/account',
  'POST /api/v1/order',
]);

export function isAllowedSignedRequest(method: string, path: string): boolean {
  return ALLOWED.has(`${method} ${path}`);
}
