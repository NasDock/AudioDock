import { buildTheme } from 'features_ui';
import type { Theme } from 'features_ui';
import { t } from 'features_i18n';
import type { VipCurrentLowestPriceData } from 'features_network';

/** 格式化价格：整数不带小数点，非整数保留两位 */
function formatPrice(price: number): string {
  return Number.isInteger(price) ? price.toString() : price.toFixed(2);
}

/** 格式化活动日期区间（yyyy-MM-dd） */
function formatActivityDateRange(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined,
): string {
  if (!startsAt || !endsAt) return '';
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  const pad = (v: number): string => v.toString().padStart(2, '0');
  const fmt = (d: Date): string =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${fmt(start)} - ${fmt(end)}`;
}

/**
 * 全局优惠活动弹窗
 *
 * 启动时检测到当前有 VIP 优惠活动（activityId != null）时弹出。
 * 用户可：
 *   - 「去查看」→ 跳转会员权益页，弹窗关闭
 *   - 「下次再说」→ 仅关闭，下次启动仍会弹
 *   - 勾选「忽略此活动」后任一关闭 → 写入 kvStore，该活动不再弹
 */
@Component
export struct PromotionDialog {
  @Prop theme: Theme = buildTheme('light');
  /** 当前活动数据 */
  promotion: VipCurrentLowestPriceData | null = null;
  /** 关闭弹窗（不忽略，下次启动仍会询问） */
  onClose: () => void = () => {};
  /** 忽略当前活动（勾选复选框后关闭时调用，写入 kvStore） */
  onIgnore: () => void = () => {};
  /** 「去查看」→ 跳会员权益页 */
  onGoView: () => void = () => {};

  @State ignoreChecked: boolean = false;

  /** 关闭时的统一处理：勾选忽略则写存储 */
  private handleClose(): void {
    if (this.ignoreChecked) {
      this.onIgnore();
    } else {
      this.onClose();
    }
    this.ignoreChecked = false;
  }

  /** 「去查看」→ 跳会员权益页 */
  private handleGoView(): void {
    this.handleClose();
    this.onGoView();
  }

  build() {
    if (this.promotion) {
      Column() {
        // 活动名称
        Text(this.promotion.name || t('promotion.title'))
          .fontSize(18)
          .fontWeight(700)
          .fontColor(this.theme.colors.text)
          .textAlign(TextAlign.Center)
          .width('100%')
          .margin({ bottom: 8 });

        // 活动日期区间
        Text(formatActivityDateRange(this.promotion.startsAt, this.promotion.endsAt))
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
          .textAlign(TextAlign.Center)
          .width('100%')
          .margin({ bottom: 12 })
          .visibility(
            formatActivityDateRange(this.promotion.startsAt, this.promotion.endsAt).length > 0
              ? Visibility.Visible
              : Visibility.None
          );

        // 活动描述
        if (this.promotion.description) {
          Scroll() {
            Text(this.promotion.description)
              .fontSize(14)
              .lineHeight(22)
              .fontColor(this.theme.colors.text)
              .textAlign(TextAlign.Center)
              .width('100%');
          }
          .constraintSize({ maxHeight: 160 })
          .margin({ bottom: 16 });
        }

        // 价格摘要
        Row() {
          if (this.promotion.annual) {
            Text(t('promotion.annualPrice', [['price', formatPrice(this.promotion.annual.currentPrice)]]))
              .fontSize(15)
              .fontWeight(700)
              .fontColor(this.theme.colors.primary);
          }
          if (this.promotion.lifetime) {
            Text(t('promotion.lifetimePrice', [['price', formatPrice(this.promotion.lifetime.currentPrice)]]))
              .fontSize(15)
              .fontWeight(700)
              .fontColor(this.theme.colors.primary);
          }
        }
        .justifyContent(FlexAlign.Center)
        .width('100%')
        .margin({ bottom: 20 });

        // 忽略此活动复选框
        Row() {
          Checkbox()
            .select(this.ignoreChecked)
            .selectedColor(this.theme.colors.primary)
            .width(18)
            .height(18)
            .onChange((checked: boolean) => {
              this.ignoreChecked = checked;
            });
          Text(t('promotion.ignoreActivity'))
            .fontSize(13)
            .fontColor(this.theme.colors.textSecondary)
            .margin({ left: 8 });
        }
        .justifyContent(FlexAlign.Center)
        .width('100%')
        .margin({ bottom: 24 });

        // 按钮行
        Row() {
          Column() {
            Text(t('promotion.nextTime'))
              .fontSize(16)
              .fontWeight(600)
              .fontColor(this.theme.colors.text);
          }
          .layoutWeight(1)
          .height(46)
          .borderRadius(23)
          .borderWidth(0.5)
          .borderColor(this.theme.colors.border)
          .justifyContent(FlexAlign.Center)
          .onClick((): void => this.handleClose());

          Column() {
            Text(t('promotion.goView'))
              .fontSize(16)
              .fontWeight(600)
              .fontColor(this.theme.colors.background);
          }
          .layoutWeight(1)
          .height(46)
          .borderRadius(23)
          .backgroundColor(this.theme.colors.primary)
          .justifyContent(FlexAlign.Center)
          .margin({ left: 12 })
          .onClick((): void => this.handleGoView());
        }
        .width('100%');
      }
      .width('100%')
      .constraintSize({ maxWidth: 400 })
      .borderRadius(16)
      .padding({ left: 24, right: 24, top: 24, bottom: 20 })
      .backgroundColor(this.theme.colors.card);
    }
  }
}
