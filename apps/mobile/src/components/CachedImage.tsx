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

  // 飞牛这类数据源的封面接口只认 Authorization 头：
  // 落盘缓存和最终渲染都要带上，否则 401。
  const headers = useMemo(() => {
    if (!source || Array.isArray(source) || typeof source === "number") return undefined;
    return (source as { headers?: Record<string, string> }).headers;
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

    cacheCover(remoteUri, headers).then((uri) => {
      if (isMounted) {
        setCachedUri(uri);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [remoteUri, headers]);

  if (typeof source === "number" || Array.isArray(source)) {
    return <Image {...props} source={source} />;
  }

  return (
    <Image
      {...props}
      source={{
        ...(source || {}),
        uri: cachedUri || remoteUri || undefined,
        headers,
      }}
    />
  );
};
