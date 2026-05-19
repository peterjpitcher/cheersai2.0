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

const MAX_DISPLAY_LENGTH = 11;

export function displayTeamName(name: string): string {
  const abbrev = LONG_NAME_ABBREVIATIONS[name];
  if (abbrev) return abbrev;
  if (name.length > MAX_DISPLAY_LENGTH) {
    const lower = name.toLowerCase();
    for (const [full, short] of Object.entries(LONG_NAME_ABBREVIATIONS)) {
      if (full.toLowerCase() === lower) return short;
    }
  }
  return name;
}
