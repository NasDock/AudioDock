import React, { useState } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useTheme } from '../context/ThemeContext';
import type { VipCurrentLowestPriceData } from '@soundx/services';

interface PromotionDialogProps {
  /** 是否展示 */
  visible: boolean;
  /** 当前活动数据（null 时不展示内容） */
  promotion: VipCurrentLowestPriceData | null;
  /** 关闭弹窗（不忽略，下次启动仍会询问） */
  onClose: () => void;
  /** 忽略当前活动（勾选复选框后关闭时调用，写入 AsyncStorage） */
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
 *   - 勾选「忽略此活动」后任一关闭 → 写入 AsyncStorage，该活动不再弹
 */
export const PromotionDialog = ({
  visible,
  promotion,
  onClose,
  onIgnore,
}: PromotionDialogProps) => {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [ignoreChecked, setIgnoreChecked] = useState(false);

  if (!promotion) return null;

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
    router.push('/member-benefits' as any);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={[styles.dialog, { backgroundColor: colors.card }]}>
          {/* 活动名称 */}
          <Text style={[styles.title, { color: colors.text }]}>
            {promotion.name || t('promotion.title')}
          </Text>

          {/* 活动日期区间 */}
          {!!dateRange && (
            <Text style={[styles.dateRange, { color: colors.secondary }]}>
              {dateRange}
            </Text>
          )}

          {/* 活动描述 */}
          {!!promotion.description && (
            <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
              <Text style={[styles.description, { color: colors.text }]}>
                {promotion.description}
              </Text>
            </ScrollView>
          )}

          {/* 价格摘要 */}
          <View style={styles.priceRow}>
            {promotion.annual && (
              <Text style={[styles.priceText, { color: colors.primary }]}>
                {t('promotion.annualPrice', {
                  price: formatPrice(promotion.annual.currentPrice),
                })}
              </Text>
            )}
            {promotion.lifetime && (
              <Text style={[styles.priceText, { color: colors.primary }]}>
                {t('promotion.lifetimePrice', {
                  price: formatPrice(promotion.lifetime.currentPrice),
                })}
              </Text>
            )}
          </View>

          {/* 忽略此活动复选框 */}
          <TouchableOpacity
            style={styles.checkboxRow}
            activeOpacity={0.8}
            onPress={() => setIgnoreChecked((v) => !v)}
          >
            <View
              style={[
                styles.checkbox,
                {
                  borderColor: ignoreChecked ? colors.primary : colors.border,
                  backgroundColor: ignoreChecked ? colors.primary : 'transparent',
                },
              ]}
            >
              {ignoreChecked && (
                <Text style={[styles.checkmark, { color: colors.background }]}>
                  ✓
                </Text>
              )}
            </View>
            <Text style={[styles.checkboxLabel, { color: colors.secondary }]}>
              {t('promotion.ignoreActivity')}
            </Text>
          </TouchableOpacity>

          {/* 按钮行 */}
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: colors.border }]}
              activeOpacity={0.8}
              onPress={handleClose}
            >
              <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
                {t('promotion.nextTime')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              activeOpacity={0.8}
              onPress={handleGoView}
            >
              <Text style={[styles.primaryButtonText, { color: colors.background }]}>
                {t('promotion.goView')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '80%',
    borderRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  dateRange: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: {
    maxHeight: 200,
    marginBottom: 12,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 16,
  },
  priceText: {
    fontSize: 15,
    fontWeight: '700',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmark: {
    fontSize: 12,
    fontWeight: '700',
  },
  checkboxLabel: {
    fontSize: 13,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  primaryButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
