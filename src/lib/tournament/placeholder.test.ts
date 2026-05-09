import { describe, it, expect } from 'vitest';
import { isPlaceholderTeamName } from './placeholder';

describe('isPlaceholderTeamName', () => {
  it('should detect single letter + digits', () => {
    expect(isPlaceholderTeamName('A1')).toBe(true);
    expect(isPlaceholderTeamName('B2')).toBe(true);
    expect(isPlaceholderTeamName('C3')).toBe(true);
  });

  it('should detect W + digits', () => {
    expect(isPlaceholderTeamName('W73')).toBe(true);
    expect(isPlaceholderTeamName('W89')).toBe(true);
  });

  it('should detect digit + letter', () => {
    expect(isPlaceholderTeamName('1C')).toBe(true);
    expect(isPlaceholderTeamName('2F')).toBe(true);
  });

  it('should detect RU + digits', () => {
    expect(isPlaceholderTeamName('RU101')).toBe(true);
    expect(isPlaceholderTeamName('RU102')).toBe(true);
  });

  it('should detect complex group references', () => {
    expect(isPlaceholderTeamName('3ABCDF')).toBe(true);
    expect(isPlaceholderTeamName('3CDFGH')).toBe(true);
    expect(isPlaceholderTeamName('3EHIJK')).toBe(true);
  });

  it('should detect FIFA/UEFA qualifiers', () => {
    expect(isPlaceholderTeamName('FIFA PO 1')).toBe(true);
    expect(isPlaceholderTeamName('UEFA PO A')).toBe(true);
    expect(isPlaceholderTeamName('UEFA PO D')).toBe(true);
  });

  it('should NOT detect real team names', () => {
    expect(isPlaceholderTeamName('Germany')).toBe(false);
    expect(isPlaceholderTeamName('Japan')).toBe(false);
    expect(isPlaceholderTeamName('Bosnia & Herzegovina')).toBe(false);
    expect(isPlaceholderTeamName('USA')).toBe(false);
    expect(isPlaceholderTeamName('England')).toBe(false);
  });
});
