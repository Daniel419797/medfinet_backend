function safeBinding(binding) {
  const {
    personalizationNonceHash,
    uidHash,
    originalitySignatureHash,
    ...safe
  } = binding;
  return safe;
}

module.exports = { safeBinding };
