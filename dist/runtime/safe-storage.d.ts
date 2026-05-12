export interface SafeStorage {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
}
export declare function createSafeSessionStorage(): SafeStorage;
