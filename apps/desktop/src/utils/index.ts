import { SOURCEMAP } from "@soundx/services";
import { resolveArtworkUri } from "../services/trackResolver";

export const getCoverUrl = (path?: string | null | any, id?: number | string) => {
  if (typeof path === "object" && path !== null) {
    return (
      resolveArtworkUri(path) || `https://picsum.photos/seed/${path.id || id}/300/300`
    );
  }
  return resolveArtworkUri(path) || `https://picsum.photos/seed/${id}/300/300`;
};

export const isSubsonicSource = () => {
  const sourceName = localStorage.getItem("selectedSourceType") as keyof typeof SOURCEMAP;
  const sourceType = SOURCEMAP[sourceName];
  return sourceType === SOURCEMAP.Subsonic;
};

export const isEmbySource = () => {
  const sourceName = localStorage.getItem("selectedSourceType") as keyof typeof SOURCEMAP;
  const sourceType = SOURCEMAP[sourceName];
  return sourceType === SOURCEMAP.Emby;
};
