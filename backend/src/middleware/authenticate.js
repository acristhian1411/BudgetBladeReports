import { getUserFromToken } from '../auth/laravel.js';

/**
 * Middleware: Extract Bearer token and validate against Laravel auth server
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();

    if (!token) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const user = await getUserFromToken(token);
    req.user = user;
    next();
  } catch (error) {
    console.error('Authentication error:', error.message);
    res.status(401).json({ error: 'Invalid token', details: error.message });
  }
};
