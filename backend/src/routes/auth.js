import express from 'express';
import { getUserFromToken, loginWithLaravel } from '../services/laravelAuth.js';

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

export function authRouter() {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    try {
      const { email, password, scope } = req.body ?? {};
      if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
      }

      const tokenPayload = await loginWithLaravel({ email, password, scope });
      return res.status(200).json(tokenPayload);
    } catch (error) {
      const status = error.status || 401;
      return res.status(status).json({ error: error.message || 'Login failed' });
    }
  });

  router.get('/me', async (req, res) => {
    const token = getBearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    try {
      const user = await getUserFromToken(token);
      return res.status(200).json({ user });
    } catch (error) {
      const status = error.status || 401;
      return res.status(status).json({ error: error.message || 'Unauthorized' });
    }
  });

  return router;
}
