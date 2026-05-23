const LONG_NAME_ABBREVIATIONS: Record<string, string> = {
  'Czech Republic': 'Czech Rep.',
  'Bosnia and Herzegovina': 'Bosnia & Herz.',
  'Trinidad and Tobago': 'Trinidad & Tob.',
  'Dominican Republic': 'Dominican Rep.',
  'Central African Republic': 'Central Afr. Rep.',
  'Equatorial Guinea': 'Eq. Guinea',
  'Papua New Guinea': 'Papua N. Guinea',
  'Northern Ireland': 'N. Ireland',
  'Republic of Ireland': 'Rep. of Ireland',
  'United Arab Emirates': 'UAE',
  'Korea Republic': 'South Korea',
  "Korea DPR": 'North Korea',
  'Chinese Taipei': 'Chinese Taipei',
  'São Tomé and Príncipe': 'São Tomé & Prín.',
  'Antigua and Barbuda': 'Antigua & Barb.',
  'Saint Kitts and Nevis': 'St Kitts & Nevis',
  'Saint Vincent and the Grenadines': 'St Vincent & Gren.',
  'Turks and Caicos Islands': 'Turks & Caicos',
};

function normaliseNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ');
}

const LONG_NAME_ABBREVIATION_KEYS = new Map(
  Object.entries(LONG_NAME_ABBREVIATIONS).map(([full, short]) => [
    normaliseNameKey(full),
    short,
  ]),
);

export function displayTeamName(name: string): string {
  const abbrev = LONG_NAME_ABBREVIATIONS[name] ?? LONG_NAME_ABBREVIATION_KEYS.get(normaliseNameKey(name));
  if (abbrev) return abbrev;
  return name;
}
