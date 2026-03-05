declare module '../instructions/prompt.js' {
  export const INSTRUCTIONS: string;
}

declare module '../tools/livekit_tools.js' {
  export const getUserInput: unknown;
  export const verifyShortLivedMemoryPin: unknown;
  export const storeShortLivedMemory: unknown;
  export const queryShortLivedMemory: unknown;
}
