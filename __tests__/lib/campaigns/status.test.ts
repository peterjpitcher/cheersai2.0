import { computeCampaignStatus } from '@/lib/campaigns/status'

describe('computeCampaignStatus', () => {
  it('defaults to draft when there are no posts or queue entries', () => {
    const status = computeCampaignStatus({
      currentStatus: 'draft',
      postStatuses: [],
      queueStatuses: [],
    })
    expect(status).toBe('draft')
  })

  it('returns active when any post moves beyond draft', () => {
    const status = computeCampaignStatus({
      currentStatus: 'draft',
      postStatuses: ['draft', 'scheduled'],
      queueStatuses: [],
    })
    expect(status).toBe('active')
  })

  it('returns active when publishing queue has pending items', () => {
    const status = computeCampaignStatus({
      currentStatus: 'draft',
      postStatuses: ['draft'],
      queueStatuses: ['pending'],
    })
    expect(status).toBe('active')
  })

  it('returns completed when all posts are published and queue is idle', () => {
    const status = computeCampaignStatus({
      currentStatus: 'active',
      postStatuses: ['published', 'published'],
      queueStatuses: ['failed', 'completed'],
    })
    expect(status).toBe('completed')
  })

  it('keeps completed when previously completed and no data available', () => {
    const status = computeCampaignStatus({
      currentStatus: 'completed',
      postStatuses: [],
      queueStatuses: [],
    })
    expect(status).toBe('completed')
  })
})
