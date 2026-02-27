const ADJECTIVES = [
  'Silent', 'Mystic', 'Hidden', 'Cosmic', 'Shadow',
  'Secret', 'Frozen', 'Dark', 'Lost', 'Wild',
  'Neon', 'Crystal', 'Phantom', 'Stellar', 'Velvet',
];

const NOUNS = [
  'Fox', 'Raven', 'Echo', 'Wolf', 'Ghost',
  'Storm', 'Flame', 'Moon', 'Star', 'Night',
  'Spark', 'Frost', 'Dream', 'Shade', 'Wing',
];

const generatePseudo = () => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 9000 + 1000);
  return `${adj}${noun}_${number}`;
};

module.exports = generatePseudo;
