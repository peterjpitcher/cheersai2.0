import { describe, it, expect } from 'vitest';
import { interpolatePostTemplate } from './template';

describe('interpolatePostTemplate', () => {
  const baseVars = {
    team_a: 'Germany',
    team_b: 'Japan',
    date: 'Saturday 13 June',
    time: '8:00 PM',
    group_round: 'Group E',
    house_rules: 'We stay open if the pub is busy.',
    booking_url: 'https://book.theanchor.pub',
  };

  it('should replace all placeholders', () => {
    const template = '{team_a} vs {team_b} at {time}';
    const result = interpolatePostTemplate(template, baseVars);
    expect(result).toBe('Germany vs Japan at 8:00 PM');
  });

  it('should render empty string for missing values', () => {
    const template = 'Book: {booking_url}';
    const result = interpolatePostTemplate(template, { ...baseVars, booking_url: '' });
    expect(result).toBe('Book: ');
  });

  it('should handle full template', () => {
    const template = `We're showing {team_a} vs {team_b} live at The Anchor!

{group_round}
Kick-off: {date} at {time}

{house_rules}

{booking_url}`;
    const result = interpolatePostTemplate(template, baseVars);
    expect(result).toContain('Germany vs Japan');
    expect(result).toContain('Group E');
    expect(result).toContain('Saturday 13 June');
    expect(result).toContain('8:00 PM');
    expect(result).toContain('We stay open');
    expect(result).toContain('https://book.theanchor.pub');
  });

  it('should not leave raw braces for unknown placeholders', () => {
    const result = interpolatePostTemplate('{unknown}', baseVars);
    expect(result).toBe('');
  });
});
