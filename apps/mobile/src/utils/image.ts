import { getBaseURL } from "../https";

/**
 * Get full image URL
 * @param path Image path or URL
 * @param placeholder Alternative placeholder if path is missing
 * @returns Full URL
 */
export const getImageUrl = (path?: string | null, placeholder?: string) => {
  if (!path) return placeholder || "https://picsum.photos/seed/placeholder/200/200";
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  const baseURL = getBaseURL();
  const cleanBaseURL = baseURL.endsWith("/") ? baseURL.substring(0, baseURL.length - 1) : baseURL;
  const cleanPath = path.startsWith("/") ? path.substring(1) : path;
  return `${cleanBaseURL}/${cleanPath.split('/').map(encodeURIComponent).join('/')}`;
};
