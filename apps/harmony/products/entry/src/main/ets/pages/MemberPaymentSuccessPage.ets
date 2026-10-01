import router from '@ohos.router';
import { buildTheme, type Theme, type ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';
import { plusApi, setPlusAuthToken } from 'features_network';

@Entry
@Component
struct MemberPaymentSuccessPage {
  @State refreshing: boolean = true;
  @State orderId: string = '';
  @State tradeNo: string = '';
  @State method: string = 'WECHAT';
  @State paidAt: string = '';
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    const params = router.getParams() as Record<string, string> | undefined;
    this.orderId = params?.['orderId'] ?? '';
    this.tradeNo = params?.['tradeNo'] ?? '';
    this.method = (params?.['method'] ?? 'WECHAT').toUpperCase();
    const rawPaidAt = params?.['paidAt'] ?? '';
    if (rawPaidAt) {
      try {
        this.paidAt = new Date(rawPaidAt).toLocaleString();
      } catch {
        this.paidAt = rawPaidAt;
      }
    }
    this.refreshVipStatus();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async refreshVipStatus(): Promise<void> {
    this.refreshing = true;
    try {
      const userId = await kvStore.get('plus_user_id');
      const token = await kvStore.get('plus_token');
      if (token) setPlusAuthToken(token);
      if (userId) {
        await plusApi.getVipStatus(userId);
      }
    } catch (e) {
      Logger.w('PaymentSuccess', `refreshVipStatus failed: ${String(e)}`);
    } finally {
      this.refreshing = false;
    }
  }

  onPageShow(): void {
    // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
    // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效，
    // 因此用 langAtBuild 把重建延迟到页面可见时。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  build() {
    // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
    // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
    // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
    Column() {
      if (this.langAtBuild === 'zh-CN') {
        this.LocalizedContent()
      } else {
        this.LocalizedContent()
      }
    }
    .width('100%').height('100%')
    .backgroundColor(this.theme.colors.background)
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }

  @Builder
  LocalizedContent() {
    Column() {
      // Header
      Row() {
        Text('‹').fontSize(28).fontColor(this.theme.colors.text)
          .onClick(() => router.back())
          .padding({ right: 10 })
        Text(t('memberSuccess.paymentSuccess'))
          .fontSize(18).fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
        Blank().width(36)
      }
      .width('100%').height(56)
      .padding({ left: 16, right: 16 })
      .alignItems(VerticalAlign.Center)

      // Success card
      Column() {
        Text('✓')
          .fontSize(56)
          .fontColor('#2ECC71')
          .margin({ bottom: 12 })

        Text(t('memberSuccess.paymentSuccess'))
          .fontSize(20).fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .margin({ bottom: 12 })

        // Payment date
        Column() {
          Text(t('memberSuccess.paymentDate'))
            .fontSize(12).fontColor(this.theme.colors.textSecondary)
            .margin({ bottom: 4 })
          Text(this.paidAt || '-')
            .fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.text)
        }
        .width('100%').alignItems(HorizontalAlign.Start)
        .margin({ top: 8 })

        // Transaction ID
        Column() {
          Text(this.method === 'WECHAT' ? t('memberSuccess.transactionId') : t('memberSuccess.transactionId'))
            .fontSize(12).fontColor(this.theme.colors.textSecondary)
            .margin({ bottom: 4 })
          Text(this.tradeNo || this.orderId || '-')
            .fontSize(14).fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.text)
        }
        .width('100%').alignItems(HorizontalAlign.Start)
        .margin({ top: 8 })

        // Syncing indicator
        if (this.refreshing) {
          Row() {
            LoadingProgress().width(16).height(16).color(this.theme.colors.primary)
            Text(t('memberSuccess.syncingMemberStatus'))
              .fontSize(12).fontColor(this.theme.colors.textSecondary)
              .margin({ left: 8 })
          }
          .margin({ top: 10 })
        }

        // View member detail button
        Button(t('member.detail'))
          .width('100%').height(48)
          .borderRadius(12)
          .backgroundColor(this.theme.colors.primary)
          .fontColor(this.theme.colors.background)
          .fontSize(14).fontWeight(FontWeight.Medium)
          .margin({ top: 18 })
          .onClick(() => router.replaceUrl({ url: 'pages/MemberDetailPage' }))
      }
      .width('100%')
      .margin(20)
      .padding(24)
      .borderRadius(18)
      .border({ width: 1, color: this.theme.colors.border })
      .backgroundColor(this.theme.colors.card)
      .alignItems(HorizontalAlign.Center)
    }
    .width('100%').height('100%')
    .backgroundColor(this.theme.colors.background)
  }
}
