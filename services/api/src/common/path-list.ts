import * as path from 'path';

const splitPathList = (raw?: string): string[] => {
  if (!raw) return [];
  return raw
    .split(/[;,]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
};

export const resolvePathList = (raw: string | undefined, fallback: string): string[] => {
  const list = splitPathList(raw);
  const resolved = (list.length > 0 ? list : [fallback]).map((value) => path.resolve(value));
  return Array.from(new Set(resolved));
};

export const resolvePathListFromBody = (
  raw: string | string[] | undefined,
  fallback: string
): string[] => {
  if (Array.isArray(raw)) {
    const normalized = raw
      .flatMap((value) => splitPathList(value))
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (normalized.length > 0) {
      return Array.from(new Set(normalized.map((value) => path.resolve(value))));
    }
  }
  return resolvePathList(typeof raw === 'string' ? raw : undefined, fallback);
};
