function addressString(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value.addr) return addressString(value.addr);
  return value.toString();
}

function positiveRound(value) {
  if (value === undefined || value === null) return false;
  try {
    return BigInt(value) > 0n;
  } catch {
    return false;
  }
}

module.exports = { addressString, positiveRound };
