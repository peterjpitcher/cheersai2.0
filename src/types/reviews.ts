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
