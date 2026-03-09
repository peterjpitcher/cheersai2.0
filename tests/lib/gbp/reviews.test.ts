import { describe, it, expect } from 'vitest';
import { starRatingToNumber, buildUpsertRow } from '@/lib/gbp/reviews';

describe('starRatingToNumber', () => {
  it('should convert string ratings to numbers', () => {
    expect(starRatingToNumber('ONE')).toBe(1);
    expect(starRatingToNumber('THREE')).toBe(3);
    expect(starRatingToNumber('FIVE')).toBe(5);
  });

  it('should return 0 for unknown values', () => {
    expect(starRatingToNumber('UNKNOWN')).toBe(0);
  });
});

describe('buildUpsertRow', () => {
  it('should map a GmbApiReview to a DB row', () => {
    const review = {
      name: 'accounts/123/locations/456/reviews/abc',
      reviewId: 'abc',
      reviewer: { displayName: 'Jane Doe' },
      starRating: 'FOUR' as const,
      comment: 'Great pub!',
      createTime: '2026-03-01T10:00:00Z',
      updateTime: '2026-03-01T10:00:00Z',
    };
    const row = buildUpsertRow('profile-id', review);
    expect(row.google_review_id).toBe('abc');
    expect(row.reviewer_name).toBe('Jane Doe');
    expect(row.star_rating).toBe(4);
    expect(row.comment).toBe('Great pub!');
    expect(row.status).toBe('pending');
    expect(row.business_profile_id).toBe('profile-id');
  });

  it('should set status to replied when review has a reply', () => {
    const review = {
      name: 'accounts/123/locations/456/reviews/abc',
      reviewId: 'abc',
      reviewer: { displayName: 'Jane Doe' },
      starRating: 'FIVE' as const,
      createTime: '2026-03-01T10:00:00Z',
      updateTime: '2026-03-01T10:00:00Z',
      reviewReply: { comment: 'Thank you!', updateTime: '2026-03-02T10:00:00Z' },
    };
    const row = buildUpsertRow('profile-id', review);
    expect(row.status).toBe('replied');
    expect(row.reply_comment).toBe('Thank you!');
  });
});
