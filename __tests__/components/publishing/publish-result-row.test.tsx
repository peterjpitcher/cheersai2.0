import React from 'react';
import { render, screen } from '@testing-library/react';
import PublishResultRow from '@/components/publishing/PublishResultRow';

describe('PublishResultRow platform labels', () => {
  it('maps google_my_business to Google Business Profile', () => {
    render(
      <PublishResultRow platform="google_my_business" name="GMB" success={true} />
    );
    expect(screen.getByText('Google Business Profile')).toBeInTheDocument();
  });

  it('maps instagram_business to Instagram', () => {
    render(
      <PublishResultRow platform="instagram_business" name="IG" success={true} />
    );
    expect(screen.getByText('Instagram')).toBeInTheDocument();
  });

  it('renders unknown platform label', () => {
    render(
      <PublishResultRow platform="facebook" name="Meta" success={false} error="rate limited" />
    );
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('rate limited')).toBeInTheDocument();
  });
});
