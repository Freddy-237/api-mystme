/**
 * Generate a DiceBear avatar URL from a seed.
 * Uses the "bottts" style — fun robot avatars.
 */
const generateAvatar = (seed) => {
  const safeSeed = seed || Math.random().toString(36).slice(2);
  return `https://api.dicebear.com/7.x/bottts/svg?seed=${safeSeed}`;
};

module.exports = generateAvatar;
