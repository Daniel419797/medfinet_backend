const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer ([^\s]+)$/);
  return match?.[1] || null;
}

function createAuthMiddleware({
  supabaseClient,
  jwtLibrary = jwt,
  configuration,
} = {}) {
  const activeConfiguration = configuration || require('../config');
  const identityProvider = supabaseClient || createClient(
    activeConfiguration.supabase.url,
    activeConfiguration.supabase.anonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );

  return async function auth(req, res, next) {
    const token = bearerToken(req.headers.authorization);
    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'AUTHENTICATION_REQUIRED',
        message: 'A valid Bearer token is required',
      });
    }

    try {
      const { data, error } = await identityProvider.auth.getUser(token);
      if (!error && data?.user?.id) {
        const claims = jwtLibrary.decode?.(token) || {};
        req.user = data.user;
        req.authenticationMethod = 'supabase';
        req.authenticationAssurance = claims.aal || 'aal1';
        req.authenticatedAt = Number.isInteger(claims.iat)
          ? new Date(claims.iat * 1000)
          : null;
        return next();
      }

      if (activeConfiguration.auth.allowLegacyJwt) {
        const decoded = jwtLibrary.verify(token, activeConfiguration.jwtSecret);
        if (!decoded?.sub && !decoded?.id && !decoded?.hospital_id) {
          throw new Error('Legacy token has no supported subject');
        }
        req.user = decoded;
        req.authenticationMethod = 'legacy-jwt';
        req.authenticationAssurance = 'aal1';
        req.authenticatedAt = Number.isInteger(decoded.iat)
          ? new Date(decoded.iat * 1000)
          : null;
        return next();
      }

      return res.status(401).json({
        success: false,
        code: 'INVALID_ACCESS_TOKEN',
        message: 'The access token is invalid or expired',
      });
    } catch {
      return res.status(401).json({
        success: false,
        code: 'INVALID_ACCESS_TOKEN',
        message: 'The access token is invalid or expired',
      });
    }
  };
}

let defaultAuthMiddleware;
function auth(req, res, next) {
  defaultAuthMiddleware ||= createAuthMiddleware();
  return defaultAuthMiddleware(req, res, next);
}

module.exports = {
  auth,
  bearerToken,
  createAuthMiddleware,
};
