import { filterNavItems, subNavPresets, type NavItem } from '@/lib/nav';

describe('nav filtering', () => {
  test('allows all dashboard items for default context', () => {
    const items = subNavPresets.dashboard as NavItem[];
    const filtered = filterNavItems(items, {});
    expect(filtered).toMatchSnapshot();
  });

  test('respects plan requirements', () => {
    const items: NavItem[] = [
      { label: 'Starter', to: '/s', requiresPlan: 'starter' },
      { label: 'Pro', to: '/p', requiresPlan: 'professional' },
      { label: 'Enterprise', to: '/e', requiresPlan: 'enterprise' },
    ];
    expect(filterNavItems(items, { plan: 'starter' })).toMatchSnapshot('starter');
    expect(filterNavItems(items, { plan: 'professional' })).toMatchSnapshot('professional');
    expect(filterNavItems(items, { plan: 'enterprise' })).toMatchSnapshot('enterprise');
  });

  test('respects role requirements', () => {
    const items: NavItem[] = [
      { label: 'ViewerOnly', to: '/v', requiresRole: 'viewer' },
      { label: 'Editor', to: '/e', requiresRole: 'editor' },
      { label: 'Admin', to: '/a', requiresRole: 'admin' },
    ];
    expect(filterNavItems(items, { role: 'viewer' })).toMatchSnapshot('viewer');
    expect(filterNavItems(items, { role: 'editor' })).toMatchSnapshot('editor');
    expect(filterNavItems(items, { role: 'admin' })).toMatchSnapshot('admin');
  });
});

