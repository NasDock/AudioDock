import React, { useEffect, useMemo, useState } from "react";
import { Image, type ImageProps } from "react-native";
import { cacheCover } from "../services/cache";

type CachedImageProps = ImageProps;

export const CachedImage: React.FC<CachedImageProps> = ({ source, ...props }) => {
  const [cachedUri, setCachedUri] = useState<string | null>(null);

  const remoteUri = useMemo(() => {
    if (!source || Array.isArray(source)) return null;
    if (typeof source === "number") return null;
    return source.uri || null;
  }, [source]);

  useEffect(() => {
    let isMounted = true;

    if (!remoteUri) {
      setCachedUri(null);
      return;
    }

    if (!remoteUri.startsWith("http://") && !remoteUri.startsWith("https://")) {
      setCachedUri(remoteUri);
      return;
    }

    cacheCover(remoteUri).then((uri) => {
      if (isMounted) {
        setCachedUri(uri);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [remoteUri]);

  if (typeof source === "number" || Array.isArray(source)) {
    return <Image {...props} source={source} />;
  }

  return <Image {...props} source={{ ...(source || {}), uri: cachedUri || remoteUri || undefined }} />;
};
