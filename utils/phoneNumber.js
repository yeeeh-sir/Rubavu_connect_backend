function normalizePhoneNumber(phoneNumber) {
  if (typeof phoneNumber !== 'string') return null;
  return phoneNumber.trim().replace(/[()\s.-]/g, '') || null;
}

function isValidPhoneNumber(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  return normalized !== null && /^\+?\d{7,15}$/.test(normalized);
}

module.exports = { normalizePhoneNumber, isValidPhoneNumber };
