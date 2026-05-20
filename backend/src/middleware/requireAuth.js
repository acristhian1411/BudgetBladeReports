import { getUserFromToken } from '../services/laravelAuth.js';

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
      req.authUser = authUser;
      next();
    } catch (error) {
      const status = error.status === 401 ? 401 : 403;
      return res.status(status).json({ error: error.message || 'Unauthorized' });
    }
  };
}
