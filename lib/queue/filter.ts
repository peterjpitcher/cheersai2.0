export type QueueStatus = 'all' | 'pending' | 'failed' | 'cancelled'
export type Approval = 'all' | 'pending' | 'approved' | 'rejected'

export interface MinimalQueueItem {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  campaign_posts?: { approval_status?: 'pending' | 'approved' | 'rejected' | null }
  scheduled_for?: string
}

export function filterQueueItems<T extends MinimalQueueItem>(
  items: T[],
  statusFilter: QueueStatus,
  approvalFilter: Approval
): T[] {
  const byStatus = items.filter((item) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'failed') return item.status === 'failed'
    if (statusFilter === 'cancelled') return item.status === 'cancelled'
    if (statusFilter === 'pending') return ['pending', 'processing'].includes(item.status)
    return true
  })

  const byApproval = byStatus.filter((item) => {
    if (approvalFilter === 'all') return true
    const a = (item.campaign_posts?.approval_status || 'pending') as 'pending'|'approved'|'rejected'
    return a === approvalFilter
  })

  return byApproval
}

