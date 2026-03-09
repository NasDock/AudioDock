import { Text, View } from '@tarojs/components';
import './index.scss';

interface QuickLocateProps {
  onTop: () => void;
  onBottom: () => void;
  onLocate?: () => void;
  showLocate?: boolean;
  locateDisabled?: boolean;
}

export default function QuickLocate({
  onTop,
  onBottom,
  onLocate,
  showLocate = true,
  locateDisabled = false,
}: QuickLocateProps) {
  return (
    <View className='quick-locate'>
      <View className='quick-locate-btn' onClick={onTop}>
        <Text className='quick-locate-icon'>↑</Text>
      </View>

      {showLocate && onLocate && (
        <View
          className={`quick-locate-btn ${locateDisabled ? 'disabled' : ''}`}
          onClick={() => {
            if (!locateDisabled) onLocate();
          }}
        >
          <Text className='quick-locate-icon'>◎</Text>
        </View>
      )}

      <View className='quick-locate-btn' onClick={onBottom}>
        <Text className='quick-locate-icon'>↓</Text>
      </View>
    </View>
  );
}
