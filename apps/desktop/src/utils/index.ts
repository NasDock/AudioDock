import { SOURCEMAP } from "@soundx/services";
import { resolveArtworkUri } from "../services/trackResolver";

export const getCoverUrl = (path?: string | null | any, id?: number | string) => {
  const resolved = resolveArtworkUri(path);
  if (resolved) return resolved;

  // Generate a simple stable hash for the fallback seed
  const seed = String((path && typeof path === 'object' ? path.id : null) || id || "default");
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash) + seed.charCodeAt(i);
      hash |= 0;
  }
  return `https://picsum.photos/seed/${Math.abs(hash)}/300/300`;
};

export const isSubsonicSource = () => {
  const sourceName = localStorage.getItem("selectedSourceType") as keyof typeof SOURCEMAP;
  const sourceType = SOURCEMAP[sourceName];
  return sourceType === SOURCEMAP.Subsonic;
};
