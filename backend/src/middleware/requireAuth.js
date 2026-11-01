import { getUserFromToken } from '../services/laravelAuth.js';
import { ensureUserCategories } from '../db/defaults.js';

function getBearerToken(authorizationHeader) {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
}

export function requireAuth() {
  return async (req, res, next) => {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    try {
      const authUser = await getUserFromToken(token);
      const userId = authUser?.id == null ? null : String(authUser.id);
      if (!userId) {
        return res.status(401).json({ error: 'Auth server did not return a user id' });
      }

      req.authUser = authUser;
      req.userId = userId;

      // First authenticated request for this account: give it its own default
      // category catalog. No-op after that.
      await ensureUserCategories(req.app.locals.db, userId);
      next();
    } catch (error) {
      const status = error.status === 401 ? 401 : 403;
      return res.status(status).json({ error: error.message || 'Unauthorized' });
    }
  };
}
