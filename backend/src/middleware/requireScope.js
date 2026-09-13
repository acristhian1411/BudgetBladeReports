import { extractScopes } from '../services/laravelAuth.js';

/**
 * Middleware factory that requires the authenticated token to have a given
 * OAuth scope. Must run after `requireAuth` (which populates `req.authUser`).
 *
 * An empty required scope disables enforcement (only token validity, already
 * checked by `requireAuth`, is required). A wildcard `*` scope grants access
 * to everything.
 *
 * @param {string} [requiredScope] - Scope to require. Defaults to
 *   `process.env.AUTH_SYNC_SCOPE` when omitted.
 */
export const requireScope = (requiredScope) => {
  const required = (
    requiredScope ?? process.env.AUTH_SYNC_SCOPE ?? ''
  )
    .toString()
    .trim();

  return (req, res, next) => {
    if (!required) return next();

    const scopes = extractScopes(req.authUser);
    if (scopes.includes('*') || scopes.includes(required)) {
      return next();
    }

    return res
      .status(403)
      .json({ error: `Insufficient scope: '${required}' is required` });
  };
};
