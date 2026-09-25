import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SetupChecklist } from '@/features/planner/setup-checklist';
import { getSetupProgress, type SetupProgress } from '@/lib/onboarding/setup-progress';

function service(opts: { posted: number; profile: Record<string, string | null> | null; connections: Array<{ provider: string; status: string }> }) {
  return {
    from: vi.fn((table: string) => {
      const c: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) c[m] = vi.fn(() => c);
      c.maybeSingle = vi.fn().mockResolvedValue({ data: opts.profile, error: null });
      c.then = (resolve: (v: unknown) => unknown) =>
        resolve(table === 'content_items' ? { count: opts.posted, error: null } : { data: opts.connections, error: null });
      return c;
    }),
  };
}

describe('getSetupProgress', () => {
  it('shows every step to do for a brand-new venue', async () => {
    expect(await getSetupProgress(service({ posted: 0, profile: null, connections: [] }) as never, 'b')).toEqual({
      profile: false,
      facebook: false,
      instagram: false,
      firstPost: false,
      show: true,
    });
  });

  it('ticks off what is done; a broken connection does not count', async () => {
    const progress = await getSetupProgress(
      service({
        posted: 0,
        profile: { business_type: 'cafe', business_description: null },
        connections: [
          { provider: 'facebook', status: 'active' },
          { provider: 'instagram', status: 'needs_action' },
        ],
      }) as never,
      'b',
    );
    expect(progress).toMatchObject({ profile: true, facebook: true, instagram: false, show: true });
  });

  it('disappears once anything has been published (so established brands never see it)', async () => {
    const progress = await getSetupProgress(service({ posted: 12, profile: null, connections: [] }) as never, 'b');
    expect(progress).toMatchObject({ firstPost: true, show: false });
  });
});

describe('SetupChecklist', () => {
  const todo: SetupProgress = { profile: true, facebook: false, instagram: false, firstPost: false, show: true };

  it('links owners to each remaining step and counts progress', () => {
    const html = renderToStaticMarkup(<SetupChecklist progress={todo} isOwner />);
    expect(html).toContain('1 of 4 done');
    expect(html).toContain('href="/connections"');
    expect(html).toContain('href="/create"');
    expect(html).toContain('You can post with just one of the two');
  });

  it('tells members to ask an owner for the connection steps', () => {
    const html = renderToStaticMarkup(<SetupChecklist progress={todo} isOwner={false} />);
    expect(html).toContain('Ask an owner of this brand to do this.');
    expect(html).not.toContain('href="/connections"');
  });

  it('renders nothing once hidden', () => {
    expect(renderToStaticMarkup(<SetupChecklist progress={{ ...todo, show: false }} isOwner />)).toBe('');
  });
});
