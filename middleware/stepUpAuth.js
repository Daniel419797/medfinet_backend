const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

function createStepUpAuthMiddleware({ maxAgeMs = DEFAULT_MAX_AGE_MS, now = () => new Date() } = {}) {
  return function stepUpAuth(req, res, next) {
    const authenticatedAt = req.authenticatedAt instanceof Date
      ? req.authenticatedAt
      : null;
    const ageMs = authenticatedAt ? now().valueOf() - authenticatedAt.valueOf() : Infinity;
    if (
      req.authenticationMethod !== 'supabase'
      || req.authenticationAssurance !== 'aal2'
      || ageMs < 0
      || ageMs > maxAgeMs
    ) {
      return res.status(403).json({
        success: false,
        code: 'STEP_UP_AUTHENTICATION_REQUIRED',
        message: 'Recent multi-factor authentication is required for this action',
        requestId: req.requestId,
      });
    }
    return next();
  };
}

module.exports = {
  createStepUpAuthMiddleware,
  stepUpAuth: createStepUpAuthMiddleware(),
  DEFAULT_MAX_AGE_MS,
};
