class AnchorCircuitBreaker {
  constructor(options = {}) {
    this._failureThreshold = options.failureThreshold || 5;
    this._resetTimeoutMs = options.resetTimeoutMs || 60_000;
    this._failureCount = 0;
    this._state = 'CLOSED';
    this._lastFailureAt = null;
    this._lastHalfOpenAttemptAt = null;
  }

  get state() {
    return this._state;
  }

  async execute(fn) {
    if (this._state === 'OPEN') {
      const elapsed = Date.now() - this._lastFailureAt;
      if (elapsed >= this._resetTimeoutMs) {
        this._state = 'HALF_OPEN';
        this._lastHalfOpenAttemptAt = Date.now();
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    if (this._state === 'HALF_OPEN') {
      this._state = 'CLOSED';
      this._failureCount = 0;
    }
  }

  _onFailure() {
    this._failureCount++;
    this._lastFailureAt = Date.now();
    if (this._failureCount >= this._failureThreshold) {
      this._state = 'OPEN';
    }
  }

  reset() {
    this._failureCount = 0;
    this._state = 'CLOSED';
    this._lastFailureAt = null;
    this._lastHalfOpenAttemptAt = null;
  }

  toJSON() {
    return {
      state: this._state,
      failureCount: this._failureCount,
      failureThreshold: this._failureThreshold,
      lastFailureAt: this._lastFailureAt,
      resetTimeoutMs: this._resetTimeoutMs,
    };
  }
}

module.exports = AnchorCircuitBreaker;