/**
 * 黑胶唱片封面（对齐 desktop Player 的 fullPlayerCoverVinyl 效果）。
 *
 * desktop 参考系 320px 圆盘，本组件按 k = size/320 等比缩放：
 * - 底盘：径向渐变 #1a1a1a → #0a0a0a(60%) → #000（不旋转，旋转不可见）
 * - 旋转层：沟纹同心环（4px 周期、1px rgba(255,255,255,0.05)）+ 中央标签环 + 圆形封面，
 *   播放时 8s/圈匀速旋转；暂停 cancelAnimation 停在当前帧，恢复时从同一角度继续（对齐 CSS
 *   animation-play-state: paused/running 行为）
 * - 唱针（tonearm=basic）：支点在右上角外侧，暂停朝向盘心（基态 -45°），
 *   播放再逆时针摆 22.5° 落到沟纹上，600ms 带回弹
 *
 * 仅在主题 coverStyle === "vinyl" 时由 player.tsx 使用。
 */
import React, { useEffect } from "react";
import { Image, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

interface VinylCoverProps {
  /** 封面图 URL */
  uri: string;
  /** 圆盘直径（px） */
  size: number;
  isPlaying: boolean;
  /** 是否渲染唱针（主题 tonearm === "basic"） */
  tonearm?: boolean;
}

/** 旋转一圈时长（对齐 desktop vinylSpin 8s linear infinite） */
const SPIN_DURATION = 8000;
/** 唱针摆动时长/缓动（对齐 desktop transition 0.6s cubic-bezier(0.34,1.4,0.64,1)） */
const ARM_DURATION = 600;
const ARM_EASING = Easing.bezier(0.34, 1.4, 0.64, 1);

const VinylCover: React.FC<VinylCoverProps> = ({ uri, size, isPlaying, tonearm = false }) => {
  const k = size / 320; // desktop 参考系缩放系数
  const c = size / 2;
  const inset = 18 * k; // 沟纹离盘边的距离
  const labelR = 70 * k; // 中央标签环半径（desktop 140px 直径）
  const imgSize = 130 * k; // 中央封面直径
  const grooveStart = labelR + 6 * k;
  const grooveEnd = c - inset;

  // 沟纹同心环半径列表（4px 周期：3px 空 + 1px 线）
  const grooves: number[] = [];
  for (let r = grooveStart; r <= grooveEnd; r += 4 * k) grooves.push(r);

  // ─── 旋转：递归 withTiming 链，保证全程匀速；暂停 cancelAnimation 停在当前帧 ───
  const rotation = useSharedValue(0);
  const spin = () => {
    "worklet";
    rotation.value = withTiming(
      rotation.value + 360,
      { duration: SPIN_DURATION, easing: Easing.linear },
      (finished) => {
        if (finished) spin();
      },
    );
  };
  useEffect(() => {
    if (isPlaying) {
      spin();
    } else {
      cancelAnimation(rotation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value % 360}deg` }],
  }));

  // ─── 唱针：支点在 wrapper 中心（旋转默认绕中心），0° ↔ -22.5° ───
  const armLen = 220 * k;
  const reach = armLen + 12 * k; // wrapper 半边长，含唱头余量
  const pivotX = size + 4 * k; // 支点：右上角略出盘外（对齐 desktop top:-10 right:-10）
  const pivotY = 2 * k;
  const armRotation = useSharedValue(isPlaying ? -22.5 : 0);
  useEffect(() => {
    armRotation.value = withTiming(isPlaying ? -22.5 : 0, {
      duration: ARM_DURATION,
      easing: ARM_EASING,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying]);
  const armStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${armRotation.value}deg` }],
  }));

  return (
    <View style={{ width: size, height: size }}>
      {/* 底盘（静态）：径向渐变黑胶底 */}
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="vinylDisc" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#1a1a1a" />
            <Stop offset="0.6" stopColor="#0a0a0a" />
            <Stop offset="1" stopColor="#000000" />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={c} fill="url(#vinylDisc)" />
      </Svg>

      {/* 旋转层：沟纹 + 标签环 + 圆形封面 */}
      <Animated.View style={[StyleSheet.absoluteFill, spinStyle]}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          {grooves.map((r) => (
            <Circle
              key={r.toFixed(2)}
              cx={c}
              cy={c}
              r={r}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={Math.max(1, k)}
              fill="none"
            />
          ))}
          {/* 中央标签外圈高光 */}
          <Circle
            cx={c}
            cy={c}
            r={labelR}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={2 * k}
            fill="none"
          />
        </Svg>
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Image
            source={{ uri }}
            style={{
              width: imgSize,
              height: imgSize,
              borderRadius: imgSize / 2,
            }}
          />
        </View>
      </Animated.View>

      {/* 唱针（可选）：整体绕支点（wrapper 中心）摆动，基态 -45° 朝向盘心 */}
      {tonearm && (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: pivotX - reach,
              top: pivotY - reach,
              width: reach * 2,
              height: reach * 2,
            },
            armStyle,
          ]}
        >
          <Svg width={reach * 2} height={reach * 2}>
            <Defs>
              <LinearGradient id="armMetal" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#c0c0c0" />
                <Stop offset="0.4" stopColor="#808080" />
                <Stop offset="1" stopColor="#4a4a4a" />
              </LinearGradient>
              <LinearGradient id="armHead" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#2a2a2a" />
                <Stop offset="1" stopColor="#000000" />
              </LinearGradient>
              <RadialGradient id="armPivot" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor="#555555" />
                <Stop offset="0.7" stopColor="#111111" />
              </RadialGradient>
            </Defs>
            {/* 臂 + 唱头：先画成水平（从支点向左），再整体 -45° 指向盘心 */}
            <G transform={`rotate(-45 ${reach} ${reach})`}>
              <Rect
                x={reach - armLen}
                y={reach - 2 * k}
                width={armLen}
                height={4 * k}
                rx={2 * k}
                fill="url(#armMetal)"
              />
              <Rect
                x={reach - armLen - 6 * k}
                y={reach - 9 * k}
                width={12 * k}
                height={18 * k}
                rx={2 * k}
                fill="url(#armHead)"
              />
            </G>
            {/* 支点圆盘 */}
            <Circle cx={reach} cy={reach} r={7 * k} fill="url(#armPivot)" />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
});

export default React.memo(VinylCover);
