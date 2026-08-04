class DomainError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { DomainError };
