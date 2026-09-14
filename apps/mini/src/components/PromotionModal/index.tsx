import { ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VipCurrentLowestPriceData } from '@soundx/services';
import './index.scss';

interface PromotionModalProps {
  visible: boolean;
  promotion: VipCurrentLowestPriceData | null;
  /** 关闭弹窗（不忽略，下次启动仍会询问） */
  onClose: () => void;
  /** 忽略当前活动（勾选复选框后关闭时调用，写入 Taro Storage） */
  onIgnore: () => void;
}

/** 格式化价格：整数不带小数点，非整数保留两位 */
const formatPrice = (price: number) =>
  Number.isInteger(price) ? String(price) : price.toFixed(2);

/** 格式化活动日期区间（yyyy-MM-dd） */
const formatActivityDateRange = (
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): string => {
  if (!startsAt || !endsAt) return '';
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const pad = (v: number) => String(v).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${fmt(start)} - ${fmt(end)}`;
};

/**
 * 全局优惠活动弹窗
 *
 * 启动时检测到当前有 VIP 优惠活动（activityId != null）时弹出。
 * 用户可：
 *   - 「去查看」→ 跳转会员权益页，弹窗关闭
 *   - 「下次再说」→ 仅关闭，下次启动仍会弹
 *   - 勾选「忽略此活动」后任一关闭 → 写入 Taro Storage，该活动不再弹
 */
const PromotionModal: React.FC<PromotionModalProps> = ({
  visible,
  promotion,
  onClose,
  onIgnore,
}) => {
  const { t } = useTranslation();
  const [ignoreChecked, setIgnoreChecked] = useState(false);

  if (!visible || !promotion) return null;

  const dateRange = formatActivityDateRange(promotion.startsAt, promotion.endsAt);

  /** 关闭时的统一处理：勾选忽略则写存储 */
  const handleClose = () => {
    if (ignoreChecked) {
      onIgnore();
    } else {
      onClose();
    }
    setIgnoreChecked(false);
  };

  /** 「去查看」→ 跳会员权益页 */
  const handleGoView = () => {
    handleClose();
    Taro.navigateTo({ url: '/pages/member/benefits/index' });
  };

  return (
    <View className='promotion-mask' onClick={handleClose}>
      <View className='promotion-content' onClick={(e) => e.stopPropagation()}>
        {/* 活动名称 */}
        <View className='promotion-header'>
          <Text className='promotion-title'>
            {promotion.name || t('promotion.title')}
          </Text>
          {!!dateRange && (
            <Text className='promotion-date-range'>{dateRange}</Text>
          )}
        </View>

        {/* 活动描述 */}
        {!!promotion.description && (
          <ScrollView scrollY className='promotion-desc-scroll'>
            <Text className='promotion-desc'>{promotion.description}</Text>
          </ScrollView>
        )}

        {/* 价格摘要 */}
        <View className='promotion-price-row'>
          {promotion.annual && (
            <Text className='promotion-price'>
              {t('promotion.annualPrice', {
                price: formatPrice(promotion.annual.currentPrice),
              })}
            </Text>
          )}
          {promotion.lifetime && (
            <Text className='promotion-price'>
              {t('promotion.lifetimePrice', {
                price: formatPrice(promotion.lifetime.currentPrice),
              })}
            </Text>
          )}
        </View>

        {/* 忽略此活动复选框 */}
        <View
          className='promotion-checkbox-row'
          onClick={() => setIgnoreChecked((v) => !v)}
        >
          <View
            className={`promotion-checkbox ${ignoreChecked ? 'checked' : ''}`}
          >
            {ignoreChecked && <Text className='promotion-checkmark'>✓</Text>}
          </View>
          <Text className='promotion-checkbox-label'>
            {t('promotion.ignoreActivity')}
          </Text>
        </View>

        {/* 按钮行 */}
        <View className='promotion-btn-row'>
          <View className='promotion-btn-secondary' onClick={handleClose}>
            <Text className='promotion-btn-secondary-text'>
              {t('promotion.nextTime')}
            </Text>
          </View>
          <View className='promotion-btn-primary' onClick={handleGoView}>
            <Text className='promotion-btn-primary-text'>
              {t('promotion.goView')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

export default PromotionModal;
