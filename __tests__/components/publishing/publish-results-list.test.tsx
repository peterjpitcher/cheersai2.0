import React from 'react';
import { render, screen } from '@testing-library/react';
import PublishResultsList from '@/components/publishing/PublishResultsList';

describe('PublishResultsList', () => {
  it('renders one row per result with correct status', () => {
    const connections = [
      { id: 'c1', platform: 'facebook', account_name: 'Main Page' },
      { id: 'c2', platform: 'instagram', account_name: 'Insta Biz' },
    ];
    const results = [
      { connectionId: 'c1', success: true },
      { connectionId: 'c2', success: false, error: 'API error' },
    ];

    render(<PublishResultsList results={results} connections={connections} />);

    expect(screen.getByText('Main Page')).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByText('Published')).toBeInTheDocument();

    expect(screen.getByText('Insta Biz')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('API error')).toBeInTheDocument();
  });
});

