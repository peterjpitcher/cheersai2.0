export type ReviewStatus = 'pending' | 'draft_ready' | 'replied';

export interface GbpReview {
  id: string;
  businessProfileId: string;
  googleReviewId: string;
  reviewerName: string;
  starRating: number;
  comment: string | null;
  createTime: string;
  updateTime: string;
  replyComment: string | null;
  replyUpdateTime: string | null;
  aiDraft: string | null;
  status: ReviewStatus;
  syncedAt: string;
}

// Shape returned by Google My Business API v4
export interface GmbApiReview {
  name: string;
  reviewId: string;
  reviewer: { displayName: string; isAnonymous?: boolean };
  starRating: 'ONE' | 'TWO' | 'THREE' | 'FOUR' | 'FIVE';
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
}

export interface GmbReviewsResponse {
  reviews?: GmbApiReview[];
  nextPageToken?: string;
  totalReviewCount?: number;
}

export function reviewFromDb(row: Record<string, unknown>): GbpReview {
  return {
    id: row.id as string,
    businessProfileId: row.business_profile_id as string,
    googleReviewId: row.google_review_id as string,
    reviewerName: row.reviewer_name as string,
    starRating: row.star_rating as number,
    comment: (row.comment as string | null) ?? null,
    createTime: row.create_time as string,
    updateTime: row.update_time as string,
    replyComment: (row.reply_comment as string | null) ?? null,
    replyUpdateTime: (row.reply_update_time as string | null) ?? null,
    aiDraft: (row.ai_draft as string | null) ?? null,
    status: row.status as ReviewStatus,
    syncedAt: row.synced_at as string,
  };
}
