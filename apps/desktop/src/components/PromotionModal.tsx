import { useTranslation } from 'react-i18next';
import { Button, Checkbox, Modal, Typography } from 'antd';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { VipCurrentLowestPriceData } from '@soundx/services';

const { Paragraph, Text } = Typography;

interface PromotionModalProps {
  visible: boolean;
  promotion: VipCurrentLowestPriceData | null;
  /** 关闭弹窗（不忽略，下次启动仍会询问） */
  onClose: () => void;
  /** 忽略当前活动（勾选复选框后关闭时调用，写入 localStorage） */
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
 *   - 勾选「忽略此活动」后任一关闭 → 写入 localStorage，该活动不再弹
 */
const PromotionModal: React.FC<PromotionModalProps> = ({
  visible,
  promotion,
  onClose,
  onIgnore,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
    navigate('/member-benefits');
  };

  return (
    <Modal
      title={promotion.name || t('promotion.title')}
      open={visible}
      onCancel={handleClose}
      footer={[
        <Button key="cancel" onClick={handleClose}>
          {t('promotion.nextTime')}
        </Button>,
        <Button key="view" type="primary" onClick={handleGoView}>
          {t('promotion.goView')}
        </Button>,
      ]}
    >
      {dateRange && (
        <Paragraph>
          <Text type="secondary">{dateRange}</Text>
        </Paragraph>
      )}

      {promotion.description && (
        <div style={{ maxHeight: '200px', overflowY: 'auto', padding: '8px 0' }}>
          <Paragraph style={{ lineHeight: 1.6 }}>{promotion.description}</Paragraph>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, margin: '12px 0' }}>
        {promotion.annual && (
          <Text strong style={{ color: '#faad14' }}>
            {t('promotion.annualPrice', {
              price: formatPrice(promotion.annual.currentPrice),
            })}
          </Text>
        )}
        {promotion.lifetime && (
          <Text strong style={{ color: '#faad14' }}>
            {t('promotion.lifetimePrice', {
              price: formatPrice(promotion.lifetime.currentPrice),
            })}
          </Text>
        )}
      </div>

      <Checkbox
        checked={ignoreChecked}
        onChange={(e) => setIgnoreChecked(e.target.checked)}
      >
        {t('promotion.ignoreActivity')}
      </Checkbox>
    </Modal>
  );
};

export default PromotionModal;
