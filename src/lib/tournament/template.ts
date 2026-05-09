export interface TemplateVars {
  team_a: string;
  team_b: string;
  date: string;
  time: string;
  group_round: string;
  house_rules: string;
  booking_url: string;
}

const KNOWN_KEYS: (keyof TemplateVars)[] = [
  'team_a', 'team_b', 'date', 'time', 'group_round', 'house_rules', 'booking_url',
];

export function interpolatePostTemplate(
  template: string,
  vars: TemplateVars,
): string {
  let result = template;
  for (const key of KNOWN_KEYS) {
    result = result.replaceAll(`{${key}}`, vars[key] ?? '');
  }
  // Remove any remaining unknown placeholders
  result = result.replace(/\{[a-z_]+\}/g, '');
  return result;
}
