import { render, screen, fireEvent } from '@testing-library/react';
import { SocialPreview } from '@/components/social-preview';

// Mock Next.js Image component
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ src, alt }: any) => <img src={src} alt={alt} />,
}));

describe('SocialPreview Component', () => {
  const defaultProps = {
    content: 'Test post content with #hashtag',
    imageUrl: 'https://example.com/image.jpg',
    platforms: ['facebook', 'instagram'] as string[],
  };

  it('renders with default props', () => {
    render(<SocialPreview {...defaultProps} />);
    
    expect(screen.getByText(/Test post content/)).toBeInTheDocument();
    expect(screen.getByText('Facebook')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
  });

  it('switches between platform previews', () => {
    render(<SocialPreview {...defaultProps} />);
    
    const instagramButton = screen.getByText('Instagram');
    fireEvent.click(instagramButton);
    
    // Instagram specific elements
    expect(screen.getByText('yourpubname')).toBeInTheDocument();
  });

  it('truncates long content appropriately', () => {
    const longContent = 'a'.repeat(600);
    render(<SocialPreview {...defaultProps} content={longContent} />);
    
    // Should truncate for Facebook (500 char limit)
    const content = screen.getByText(/a+.../);
    expect(content.textContent?.length).toBeLessThan(510);
  });

  it('shows platform-specific tips', () => {
    render(<SocialPreview {...defaultProps} />);
    
    expect(screen.getByText(/Facebook Post Tips/)).toBeInTheDocument();
    expect(screen.getByText(/Optimal length: 40-80 characters/)).toBeInTheDocument();
  });

  it('handles missing image for Instagram', () => {
    render(<SocialPreview {...defaultProps} imageUrl={undefined} />);
    
    const instagramButton = screen.getByText('Instagram');
    fireEvent.click(instagramButton);
    
    expect(screen.getByText(/Instagram requires an image or video/)).toBeInTheDocument();
  });

  it('formats hashtags with color', () => {
    const { container } = render(<SocialPreview {...defaultProps} />);
    
    const hashtagElements = container.querySelectorAll('.text-blue-600');
    expect(hashtagElements.length).toBeGreaterThan(0);
  });

  it('switches between mobile and desktop views', () => {
    render(<SocialPreview {...defaultProps} />);
    
    const desktopButton = screen.getByRole('button', { name: /desktop/i });
    fireEvent.click(desktopButton);
    
    // Check if container has desktop width class
    const previewContainer = screen.getByText(/Test post content/).closest('div');
    expect(previewContainer?.className).toContain('max-w-2xl');
  });
});