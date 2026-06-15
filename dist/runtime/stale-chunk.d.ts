export declare const STALE_CHUNK_PATTERNS: readonly RegExp[];
export declare function isStaleChunkMessage(message: string): boolean;
export declare const DEPLOY_NOISE_PATTERNS: readonly RegExp[];
export declare function isDeployNoiseMessage(message: string): boolean;
export declare function isStaleChunkError(err: unknown): boolean;
