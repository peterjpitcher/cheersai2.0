import { describe, it, expect } from 'vitest';
import { displayTeamName } from './team-display';

describe('displayTeamName', () => {
  it('returns short names unchanged', () => {
    expect(displayTeamName('Germany')).toBe('Germany');
    expect(displayTeamName('Japan')).toBe('Japan');
    expect(displayTeamName('Spain')).toBe('Spain');
  });

  it('abbreviates known long names', () => {
    expect(displayTeamName('Czech Republic')).toBe('Czech Rep.');
    expect(displayTeamName('Bosnia and Herzegovina')).toBe('Bosnia & Herz.');
    expect(displayTeamName('United Arab Emirates')).toBe('UAE');
    expect(displayTeamName('Korea Republic')).toBe('South Korea');
  });

  it('matches abbreviations case-insensitively', () => {
    expect(displayTeamName('czech republic')).toBe('Czech Rep.');
    expect(displayTeamName('UNITED ARAB EMIRATES')).toBe('UAE');
  });

  it('returns names at the boundary length unchanged', () => {
    expect(displayTeamName('Netherlands')).toBe('Netherlands');
  });

  it('returns unknown long names unchanged', () => {
    expect(displayTeamName('Some Very Long Team')).toBe('Some Very Long Team');
  });

  it('handles empty string', () => {
    expect(displayTeamName('')).toBe('');
  });
});
