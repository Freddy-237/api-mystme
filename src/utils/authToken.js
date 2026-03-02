const extractBearerToken = (authorizationHeader) => {
  if (!authorizationHeader || typeof authorizationHeader !== 'string') {
    return null;
  }

  const trimmed = authorizationHeader.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  if (!match) return null;

  const token = match[1]?.trim();
  return token ? token : null;
};

module.exports = {
  extractBearerToken,
};
