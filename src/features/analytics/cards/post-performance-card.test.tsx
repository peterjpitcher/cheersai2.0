// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { PostPerformanceCard } from '@/features/analytics/cards/post-performance-card';

afterEach(() => {
  cleanup();
});

describe('PostPerformanceCard', () => {
  it('shows views, people reached, the rate and link clicks', () => {
    render(<PostPerformanceCard impressions={12_400} reach={3_100} engagementRate={0.052} clicks={87} postCount={9} />);
    expect(screen.getByText('Views')).toBeInTheDocument();
    expect(screen.getByText('12.4K')).toBeInTheDocument();
    expect(screen.getByText('People reached')).toBeInTheDocument();
    expect(screen.getByText('3.1K')).toBeInTheDocument();
    expect(screen.getByText('5.2%')).toBeInTheDocument();
    expect(screen.getByText('Link clicks')).toBeInTheDocument();
    expect(screen.getByText('87')).toBeInTheDocument();
  });

  it('says reach is not in yet, rather than showing nought', () => {
    render(<PostPerformanceCard impressions={0} reach={null} engagementRate={0} clicks={0} postCount={2} />);
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
  });

  it('says the rate is not in yet when there is nothing to rate it over', () => {
    render(<PostPerformanceCard impressions={0} reach={null} engagementRate={null} clicks={0} postCount={2} />);
    expect(screen.getAllByText('Not yet')).toHaveLength(2);
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
  });
});
