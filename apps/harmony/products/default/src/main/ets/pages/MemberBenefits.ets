/**
 * Member Benefits Page - VIP Subscription & Benefits Display
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import hilog from '@ohos.hilog';


// ==================== Types ====================
interface Benefit {
  icon: string;
  title: string;
  description: string;
}

interface PaymentPlan {
  id: string;
  name: string;
  price: string;
  period: string;
  features: string[];
  recommended?: boolean;
}

// ==================== Benefits Data ====================
const BENEFITS: Benefit[] = [
  {
    icon: '🎵',
    title: '无广告聆听',
    description: '纯净音乐体验，无任何广告打扰'
  },
  {
    icon: '🤖',
    title: 'AI 语音助手',
    description: '智能语音控制播放，解放双手'
  },
  {
    icon: '📱',
    title: '多设备同步',
    description: '跨设备同步播放记录和收藏'
  },
  {
    icon: '🎧',
    title: '高品质音质',
    description: '无损音质，Hi-Fi 音乐体验'
  },
  {
    icon: '☁️',
    title: '云端存储',
    description: '更大云端空间，存储更多音乐'
  },
  {
    icon: '🔄',
    title: '优先体验',
    description: '新功能优先体验资格'
  }
];

const PLANS: PaymentPlan[] = [
  {
    id: 'monthly',
    name: '月度会员',
    price: '¥15',
    period: '月',
    features: ['无广告', '语音助手', '高品质音质']
  },
  {
    id: 'yearly',
    name: '年度会员',
    price: '¥120',
    period: '年',
    features: ['无广告', '语音助手', '高品质音质', '8折优惠'],
    recommended: true
  },
  {
    id: 'lifetime',
    name: '终身会员',
    price: '¥299',
    period: '一次性',
    features: ['无广告', '语音助手', '高品质音质', '永久有效']
  }
];

// ==================== Member Benefits Page ====================
@Entry
@Component
struct MemberBenefitsPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State selectedPlan: string = 'yearly';
  @State isLoading: boolean = false;
  @State memberBenefits: Benefit[] = BENEFITS;

  build() {
    Column() {
      // Header
      this.buildHeader()

      Scroll() {
        Column() {
          // Benefits section
          this.buildBenefitsSection()

          // Plans section
          this.buildPlansSection()
        }
        .padding(24)
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
  }

  @Builder
  buildHeader() {
    Row() {
      Image($r('app.media.icon_back'))
        .width(24)
        .height(24)
        .onClick(() => router.back())

      Text('会员权益')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Blank()
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .margin({ bottom: 16 })
  }

  @Builder
  buildBenefitsSection() {
    Column() {
      Text('会员特权')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .width('100%')
        .margin({ bottom: 16 })

      Grid() {
        ForEach(this.memberBenefits, (benefit: Benefit) => {
          GridItem() {
            Column() {
              Text(benefit.icon)
                .fontSize(28)
                .margin({ bottom: 8 })

              Text(benefit.title)
                .fontSize(14)
                .fontWeight(FontWeight.Bold)
                .fontColor(this.colors.text)
                .margin({ bottom: 4 })

              Text(benefit.description)
                .fontSize(11)
                .fontColor(this.colors.secondary)
                .textAlign(TextAlign.Center)
                .maxLines(2)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
            }
            .width('100%')
            .padding(12)
            .backgroundColor(this.colors.card)
            .borderRadius(12)
          }
        })
      }
      .columnsTemplate('1fr 1fr 1fr')
      .columnsGap(12)
      .rowsGap(12)
      .width('100%')
      .height(200)
    }
    .width('100%')
    .margin({ bottom: 32 })
  }

  @Builder
  buildPlansSection() {
    Column() {
      Text('选择套餐')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .width('100%')
        .margin({ bottom: 16 })

      ForEach(PLANS, (plan: PaymentPlan) => {
        Column() {
          Row() {
            Column() {
              Row() {
                Text(plan.name)
                  .fontSize(16)
                  .fontWeight(FontWeight.Bold)
                  .fontColor(this.colors.text)

                if (plan.recommended) {
                  Text('推荐')
                    .fontSize(10)
                    .fontColor('#FFFFFF')
                    .backgroundColor('#FF6B6B')
                    .borderRadius(4)
                    .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                    .margin({ left: 8 })
                }
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)

              Text(`${plan.price}/${plan.period}`)
                .fontSize(14)
                .fontColor(this.colors.secondary)
                .margin({ top: 4 })
            }
            .layoutWeight(1)
            .alignItems(HorizontalAlign.Start)

            // Radio button
            Stack() {
              Circle()
                .width(22)
                .height(22)
                .fill(this.selectedPlan === plan.id ? this.colors.primary : Color.Transparent)
                .stroke(this.selectedPlan === plan.id ? this.colors.primary : this.colors.border)
                .strokeWidth(2)
            }
            .width(22)
            .height(22)
          }
          .width('100%')

          // Features
          Row() {
            ForEach(plan.features, (feature: string) => {
              Text(`✓ ${feature}`)
                .fontSize(12)
                .fontColor(this.colors.primary)
                .margin({ right: 12 })
            })
          }
          .width('100%')
          .margin({ top: 12 })
        }
        .width('100%')
        .padding(16)
        .backgroundColor(this.colors.card)
        .borderRadius(16)
        .border({
          width: this.selectedPlan === plan.id ? 2 : 1,
          color: this.selectedPlan === plan.id ? this.colors.primary : this.colors.border
        })
        .margin({ bottom: 12 })
        .onClick(() => this.selectedPlan = plan.id)
      })

      // Subscribe button
      Button('立即订阅')
        .width('100%')
        .height(50)
        .borderRadius(14)
        .backgroundColor(this.colors.primary)
        .fontColor('#FFFFFF')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .margin({ top: 16 })
        .enabled(!this.isLoading)
        .onClick(() => this.handleSubscribe())

      if (this.isLoading) {
        LoadingProgress()
          .width(24)
          .height(24)
          .margin({ top: 12 })
      }
    }
    .width('100%')
  }

  async handleSubscribe() {
    this.isLoading = true;

    try {
      // In real implementation, handle payment
      const plan = PLANS.find(p => p.id === this.selectedPlan);
      promptAction.showToast({ message: `${plan?.name} - ${plan?.price}\n支付功能开发中` });
      
      // router.push({ url: 'pages/Payment', params: { planId: this.selectedPlan } });
    } catch (error) {
      hilog.error(0x0001, 'MemberBenefits', 'Subscribe failed: %{public}s', JSON.stringify(error));
      promptAction.showToast({ message: '订阅失败，请稍后重试' });
    } finally {
      this.isLoading = false;
    }
  }
}

// ==================== Theme Colors ====================
class ThemeColors {
  background: string = '#FFFFFF';
  card: string = '#F5F5F5';
  text: string = '#000000';
  secondary: string = '#666666';
  border: string = '#E0E0E0';
  primary: string = '#007AFF';
}
