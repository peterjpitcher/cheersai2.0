import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock OpenAI client before importing the module under test.
const mockParse = vi.fn();

vi.mock('./client', () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        parse: mockParse,
      },
    },
  }),
}));

// Import after mock setup.
const { generateMediaNameAndTags, buildMediaFileName, deriveExtension, MAX_MEDIA_TAGS } = await import(
  './media-tagging'
);

describe('generateMediaNameAndTags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_MODEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the parsed name and tags on the happy path', async () => {
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: { name: 'Cosy Beer Garden', tags: ['garden', 'sunset', 'beer'] } } }],
    });

    const result = await generateMediaNameAndTags({ imageUrl: 'https://example.com/signed.jpg' });

    expect(result).toEqual({ name: 'Cosy Beer Garden', tags: ['garden', 'sunset', 'beer'] });
    expect(mockParse).toHaveBeenCalledOnce();

    const callArgs = mockParse.mock.calls[0]![0];
    expect(callArgs.model).toBe('gpt-4o-mini');
    expect(callArgs.temperature).toBe(0.3);

    // The user message must include the image URL as an image_url content part.
    const userMessage = callArgs.messages.find((m: { role: string }) => m.role === 'user');
    const imagePart = userMessage.content.find((part: { type: string }) => part.type === 'image_url');
    expect(imagePart.image_url.url).toBe('https://example.com/signed.jpg');
  });

  it('respects an explicit model override', async () => {
    mockParse.mockResolvedValue({
      choices: [{ message: { parsed: { name: 'Pint', tags: ['beer'] } } }],
    });

    await generateMediaNameAndTags({ imageUrl: 'https://example.com/a.jpg', model: 'gpt-4o' });

    expect(mockParse.mock.calls[0]![0].model).toBe('gpt-4o');
  });

  it('throws when the API returns no parsed content', async () => {
    mockParse.mockResolvedValue({ choices: [{ message: { parsed: null } }] });

    await expect(generateMediaNameAndTags({ imageUrl: 'https://example.com/a.jpg' })).rejects.toThrow(
      /no parsed content/i,
    );
  });

  it('translates an AbortError into a timeout message', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mockParse.mockRejectedValue(abortError);

    await expect(generateMediaNameAndTags({ imageUrl: 'https://example.com/a.jpg' })).rejects.toThrow(
      /timed out/i,
    );
  });
});

describe('deriveExtension', () => {
  it('returns the lowercased extension including the dot', () => {
    expect(deriveExtension('IMG_1234.JPG')).toBe('.jpg');
    expect(deriveExtension('photo.png')).toBe('.png');
  });

  it('returns an empty string when there is no extension', () => {
    expect(deriveExtension('no-extension-here')).toBe('');
  });
});

describe('buildMediaFileName', () => {
  it('appends the original extension to the AI title', () => {
    expect(buildMediaFileName('Cosy Beer Garden', 'IMG_1234.jpg')).toBe('Cosy Beer Garden.jpg');
  });

  it('keeps spaces, hyphens and apostrophes but strips illegal characters', () => {
    expect(buildMediaFileName('Sunday Roast / "Special": <Best>', 'a.png')).toBe('Sunday Roast Special Best.png');
    expect(buildMediaFileName("Chef's Well-Earned Break", 'a.jpg')).toBe("Chef's Well-Earned Break.jpg");
  });

  it('falls back to the original file name when the AI title is empty or unusable', () => {
    expect(buildMediaFileName('', 'original.jpg')).toBe('original.jpg');
    expect(buildMediaFileName('///???', 'original.jpg')).toBe('original.jpg');
  });

  it('does not double-append an extension the title already carries', () => {
    expect(buildMediaFileName('photo.png', 'source.jpg')).toBe('photo.png');
  });

  it('caps very long titles at 80 characters', () => {
    const longName = 'Word '.repeat(40).trim(); // ~199 chars
    const result = buildMediaFileName(longName, 'a.jpg');
    // Strip extension for the length assertion.
    expect(result.replace(/\.jpg$/, '').length).toBeLessThanOrEqual(80);
    expect(result.endsWith('.jpg')).toBe(true);
  });
});

describe('MAX_MEDIA_TAGS', () => {
  it('is a sensible small cap', () => {
    expect(MAX_MEDIA_TAGS).toBe(6);
  });
});
