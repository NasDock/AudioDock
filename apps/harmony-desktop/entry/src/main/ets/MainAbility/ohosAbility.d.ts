// Type declarations for HarmonyOS AppStorage
declare const AppStorage: {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T) => boolean;
  delete: (key: string) => boolean;
  has: (key: string) => boolean;
  clear: () => void;
};

declare const getContext: (target?: Object) => object;

declare const globalThis: {
  filesDir: string;
  cacheDir: string;
  tempDir: string;
} & Record<string, any>;
