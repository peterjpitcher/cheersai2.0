import { filterQueueItems, type MinimalQueueItem } from '@/lib/queue/filter'

describe('filterQueueItems', () => {
  const items: MinimalQueueItem[] = [
    { status: 'pending', campaign_posts: { approval_status: 'pending' }, scheduled_for: '2025-01-01T00:00:00Z' },
    { status: 'processing', campaign_posts: { approval_status: 'approved' }, scheduled_for: '2025-01-02T00:00:00Z' },
    { status: 'failed', campaign_posts: { approval_status: 'rejected' }, scheduled_for: '2025-01-03T00:00:00Z' },
    { status: 'completed', campaign_posts: { approval_status: null }, scheduled_for: '2025-01-04T00:00:00Z' },
    { status: 'cancelled', campaign_posts: {}, scheduled_for: '2025-01-05T00:00:00Z' },
  ]

  it('filters by status = pending (includes processing)', () => {
    const res = filterQueueItems(items, 'pending', 'all')
    expect(res.map(i => i.status)).toEqual(expect.arrayContaining(['pending','processing']))
    expect(res.find(i => i.status === 'failed')).toBeUndefined()
  })

  it('filters by approval = approved', () => {
    const res = filterQueueItems(items, 'all', 'approved')
    expect(res).toHaveLength(1)
    expect(res[0].campaign_posts?.approval_status).toBe('approved')
  })

  it('treats missing approval as pending', () => {
    const res = filterQueueItems(items, 'all', 'pending')
    // pending + completed(null) + empty object
    expect(res.length).toBeGreaterThan(1)
    for (const it of res) {
      expect((it.campaign_posts?.approval_status || 'pending') === 'pending').toBe(true)
    }
  })
})

