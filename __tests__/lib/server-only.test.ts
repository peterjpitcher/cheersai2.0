describe('server-only import guard', () => {
  it('throws when imported in client env', () => {
    expect(() => {
      // Importing should throw because jsdom provides window
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('@/lib/server-only');
    }).toThrow(/server-only/);
  });
});

