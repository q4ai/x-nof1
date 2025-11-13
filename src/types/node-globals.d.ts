export {};

declare global {
  const process: {
    env: Record<string, string | undefined>;
  };

  const Buffer: {
    from(input: Uint8Array | string): {
      toString(encoding?: string): string;
    };
  };
}
