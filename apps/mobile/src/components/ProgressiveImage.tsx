/**
 * 渐进式封面：先用低档占位图（列表已加载、命中缓存）立即显示，后台预载高清图，
 * 加载完成后替换为高清，避免"点击列表播放 → mini/详情页封面重新下载期间黑屏"。
 *
 * 实现：显示层始终有图（占位或已就绪的高清），另挂一个隐藏 Image 预载高清，
 * onLoad 后才把显示层切到高清。RN Image 对同一 uri 的内存缓存共享，切换即命中；
 * 隐藏 Image 支持 headers（飞牛封面只认 Authorization 头，Image.prefetch 不支持）。
 *
 * 切歌竞态：placeholderSource 的 uri 变化即视为换图，立即回落占位并废弃旧高清；
 * 预载完成回调校验占位 uri 未变，避免上一首高清盖到新曲上。
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  ImageSourcePropType,
  LayoutChangeEvent,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from "react-native";

interface ProgressiveImageProps {
  /** 高清目标图（可含 headers） */
  source: ImageSourcePropType;
  /** 低档占位图（与播放列表同参数，命中缓存秒开；可含 headers） */
  placeholderSource: ImageSourcePropType;
  /** 外层容器样式（承载宽高/圆角等布局） */
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  testID?: string;
}

const getUri = (source: ImageSourcePropType): string | undefined => {
  if (!source || typeof source === "number") return undefined;
  if (Array.isArray(source)) return source[0]?.uri;
  return (source as { uri?: string }).uri;
};

const ProgressiveImage: React.FC<ProgressiveImageProps> = ({
  source,
  placeholderSource,
  style,
  onLayout,
  testID,
}) => {
  const targetUri = getUri(source);
  const placeholderUri = getUri(placeholderSource);
  const [readyUri, setReadyUri] = useState<string | undefined>(undefined);
  // 切歌判定键：占位 uri + 高清 uri 共同决定"是不是同一张待显示的图"。
  // 只比较占位 uri 会漏掉"同一首歌因内外网切换导致高清 URL 变化"（900 档内网直连原图、
  // 外网走 optimize）的情况，那种情况下 readyUri 残留会让显示层错误回落到低档图。
  const imageKey = `${placeholderUri}||${targetUri}`;
  const lastImageKeyRef = useRef(imageKey);

  // 切歌/换源：判定键变化 → 清空就绪标记，立即回落到新占位图
  useEffect(() => {
    if (imageKey !== lastImageKeyRef.current) {
      lastImageKeyRef.current = imageKey;
      setReadyUri(undefined);
    }
  }, [imageKey]);

  const hiResReady = !!targetUri && readyUri === targetUri;
  // 外链封面或占位与高清同 URL 时无需预载，直接显示
  const needsPreload = !!targetUri && targetUri !== placeholderUri && !hiResReady;
  const displaySource = hiResReady ? source : placeholderSource;

  // 目标图是否带鉴权头（飞牛封面）。prefetch 不支持 headers，带头的只能走隐藏 Image。
  const targetHeaders =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as { headers?: Record<string, string> }).headers
      : undefined;
  const hasHeaders = !!targetHeaders && Object.keys(targetHeaders).length > 0;

  // 普通源：用 RN 官方 Image.prefetch 预载高清，命中后提升显示层。
  // 只在预载真正完成时提升，且校验占位 uri 未变（防切歌竞态）。
  useEffect(() => {
    if (!needsPreload || hasHeaders || !targetUri) return;
    let cancelled = false;
    const expectedKey = imageKey;
    Image.prefetch(targetUri)
      .then(() => {
        if (!cancelled && lastImageKeyRef.current === expectedKey) {
          setReadyUri(targetUri);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsPreload, hasHeaders, targetUri, placeholderUri, imageKey]);

  const promoteHiRes = (): void => {
    // 只在判定键未变（未切歌）时才提升，防止旧高清盖到新曲
    if (lastImageKeyRef.current === imageKey) {
      setReadyUri(targetUri);
    }
  };

  return (
    <View style={[styles.wrapper, style]} onLayout={onLayout} testID={testID}>
      <Image source={displaySource} style={styles.image} resizeMode="cover" />
      {needsPreload && hasHeaders ? (
        // 带鉴权头的源（飞牛）：prefetch 不支持 headers，用隐藏 Image 预载兜底。
        // 1×1、透明、不拦截事件，但会正常发起带 headers 的请求。
        <View style={styles.hiddenPreloader} pointerEvents="none">
          {/* key 绑定目标 uri：切歌时旧实例卸载，其迟到的 onLoad 携带旧 imageKey 会被
              promoteHiRes 拒绝，避免把上一首的高清盖到新曲（飞牛带 headers 源尤其重要） */}
          <Image key={targetUri} source={source} style={styles.preloadImage} onLoad={promoteHiRes} />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    overflow: "hidden",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  hiddenPreloader: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    overflow: "hidden",
  },
  preloadImage: {
    width: 1,
    height: 1,
  },
});

export default ProgressiveImage;
