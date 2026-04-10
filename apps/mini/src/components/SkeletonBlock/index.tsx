import { View } from '@tarojs/components';
import './index.scss';

interface SkeletonBlockProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  className?: string;
}

export default function SkeletonBlock({
  width = '100%',
  height = 20,
  borderRadius = 8,
  className = '',
}: SkeletonBlockProps) {
  return (
    <View
      className={`skeleton-block ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}rpx` : width,
        height: typeof height === 'number' ? `${height}rpx` : height,
        borderRadius: `${borderRadius}rpx`,
      }}
    />
  );
}
