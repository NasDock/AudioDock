import { WidgetIcon } from './WidgetIcon';

/**
 * VIP 锁定页（对齐 iOS AudioDockPlayerLockOverlay）。
 *
 * - 非会员显示：皇冠图标 + 「会员专属功能」+ 「开通会员即可使用桌面小部件」
 * - 点击拉起主 App 到 MemberBenefitsPage（postCardAction router + URL scheme）
 *
 * 尺寸自适应：所有 4 种卡片都用这一个组件。
 */

@Component
export struct LockedCard {
  build() {
    Stack() {
      // 背景：暗紫蓝渐变
      Column()
        .width('100%')
        .height('100%')
        .linearGradient({
          angle: 135,
          colors: [['#1a1a2e', 0.0], ['#16213e', 1.0]],
        });

      Column({ space: 6 }) {
        // 皇冠
        WidgetIcon('crown', 28, '#FFD980');

        // 标题
        Text('会员专属功能')
          .fontSize(14)
          .fontWeight(FontWeight.Bold)
          .fontColor('#FFFFFF');

        // 副标题（2 行 wrap）
        Text('开通会员即可使用桌面小部件')
          .fontSize(11)
          .fontColor('#B3FFFFFF')
          .maxLines(2)
          .textAlign(TextAlign.Center);
      }
      .width('100%')
      .height('100%')
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .padding(16);
    }
    .width('100%')
    .height('100%')
    .onClick((): void => {
      // 拉起主 App 到会员页
      try {
        postCardAction(this, {
          action: 'router',
          abilityName: 'EntryAbility',
          params: { url: 'audiodock://member-benefits' },
        });
      } catch (e) {
        // 卡片进程有时拿不到 context，吞掉
      }
    });
  }
}
