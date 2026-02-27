const parseCookies = (rawCookieHeader) => {
  if (!rawCookieHeader || typeof rawCookieHeader !== 'string') return {};

  return rawCookieHeader
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((acc, chunk) => {
      const index = chunk.indexOf('=');
      if (index <= 0) return acc;
      const key = chunk.slice(0, index).trim();
      const value = decodeURIComponent(chunk.slice(index + 1));
      acc[key] = value;
      return acc;
    }, {});
};

module.exports = parseCookies;
