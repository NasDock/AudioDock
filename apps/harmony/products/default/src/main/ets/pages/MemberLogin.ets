/**
 * Member Login Page - VIP/Plus Member Login
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import hilog from '@ohos.hilog';
import { authStore } from '../store';
import { ROUTE_TABS, ROUTE_MEMBER_BENEFITS } from '../constants/RouteConstants';

// ==================== Types ====================
enum MemberLoginMode {
  SMS = 'sms',
  SCAN = 'scan'
}

// ==================== Member Login Page ====================
@Entry
@Component
struct MemberLoginPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State loginMode: MemberLoginMode = MemberLoginMode.SMS;
  @State phone: string = '';
  @State code: string = '';
  @State loading: boolean = false;
  @State sendingCode: boolean = false;
  @State countdown: number = 0;
  @State scanStatus: string = '';

  private countdownTimer: number = -1;

  build() {
    Column() {
      this.buildHeader()

      Scroll() {
        Column() {
          // Mode tabs
          this.buildModeTabs()

          if (this.loginMode === MemberLoginMode.SMS) {
            this.buildSMSForm()
          } else {
            this.buildScanPanel()
          }
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

      Text('会员登录')
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
  buildModeTabs() {
    Row() {
      Row() {
        Text('短信登录')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.loginMode === MemberLoginMode.SMS ? '#FFFFFF' : this.colors.text)
      }
      .layoutWeight(1)
      .height(40)
      .borderRadius(10)
      .backgroundColor(this.loginMode === MemberLoginMode.SMS ? this.colors.primary : this.colors.card)
      .onClick(() => this.loginMode = MemberLoginMode.SMS)

      Row() {
        Text('扫码登录')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.loginMode === MemberLoginMode.SCAN ? '#FFFFFF' : this.colors.text)
      }
      .layoutWeight(1)
      .height(40)
      .borderRadius(10)
      .backgroundColor(this.loginMode === MemberLoginMode.SCAN ? this.colors.primary : this.colors.card)
      .onClick(() => this.loginMode = MemberLoginMode.SCAN)
    }
    .width('100%')
    .height(44)
    .borderRadius(14)
    .border({ width: 1, color: this.colors.border })
    .padding(4)
    .margin({ bottom: 24 })
  }

  @Builder
  buildSMSForm() {
    Column() {
      // Phone input
      Column() {
        Text('手机号')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.colors.text)
          .width('100%')
          .margin({ bottom: 8 })

        TextInput({ placeholder: '请输入手机号', text: this.phone })
          .width('100%')
          .height(50)
          .borderRadius(12)
          .border({ width: 1, color: this.colors.border })
          .backgroundColor(this.colors.card)
          .fontColor(this.colors.text)
          .fontSize(16)
          .placeholderColor(this.colors.secondary)
          .type(InputType.PhoneNumber)
          .maxLines(1)
          .onChange((val) => this.phone = val)
      }
      .width('100%')
      .margin({ bottom: 16 })

      // SMS Code input
      Column() {
        Text('验证码')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.colors.text)
          .width('100%')
          .margin({ bottom: 8 })

        Row() {
          TextInput({ placeholder: '请输入验证码', text: this.code })
            .layoutWeight(1)
            .height(50)
            .borderRadius(12)
            .border({ width: 1, color: this.colors.border })
            .backgroundColor(this.colors.card)
            .fontColor(this.colors.text)
            .fontSize(16)
            .placeholderColor(this.colors.secondary)
            .type(InputType.Number)
            .maxLines(1)
            .onChange((val) => this.code = val)

          Button(this.countdown > 0 ? `${this.countdown}s` : '获取验证码')
            .height(50)
            .borderRadius(12)
            .backgroundColor(this.countdown > 0 ? this.colors.card : this.colors.primary)
            .fontColor(this.countdown > 0 ? this.colors.text : '#FFFFFF')
            .fontSize(14)
            .enabled(this.countdown === 0 && !this.sendingCode)
            .onClick(() => this.handleSendCode())
        }
      }
      .width('100%')
      .margin({ bottom: 24 })

      // Submit button
      Button('登录')
        .width('100%')
        .height(50)
        .borderRadius(14)
        .backgroundColor(this.colors.primary)
        .fontColor('#FFFFFF')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .enabled(!this.loading && !this.sendingCode)
        .onClick(() => this.handleSMSLogin())

      if (this.loading || this.sendingCode) {
        LoadingProgress()
          .width(24)
          .height(24)
          .margin({ top: 12 })
      }
    }
    .width('100%')
  }

  @Builder
  buildScanPanel() {
    Column() {
      Text('扫码登录')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Text('请使用 App 扫描下方二维码')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .margin({ top: 12 })

      // QR Code placeholder
      Column() {
        Text('会员二维码区域')
          .fontSize(14)
          .fontColor(this.colors.secondary)
      }
      .width(200)
      .height(200)
      .backgroundColor('#FFFFFF')
      .borderRadius(12)
      .justifyContent(FlexAlign.Center)
      .alignItems(HorizontalAlign.Center)
      .margin({ top: 24 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
    .padding(20)
  }

  handleSendCode() {
    if (!this.phone) {
      promptAction.showToast({ message: '请输入手机号' });
      return;
    }

    this.sendingCode = true;
    this.countdown = 60;

    // Start countdown timer
    this.countdownTimer = setInterval(() => {
      this.countdown--;
      if (this.countdown <= 0) {
        clearInterval(this.countdownTimer);
      }
    }, 1000);

    // In real implementation, call plusSendCode API
    hilog.info(0x0001, 'MemberLogin', 'Send SMS code to: %{public}s', this.phone);

    promptAction.showToast({ message: '验证码已发送' });
    this.sendingCode = false;
  }

  async handleSMSLogin() {
    if (!this.phone || !this.code) {
      promptAction.showToast({ message: '请填写手机号和验证码' });
      return;
    }

    this.loading = true;

    try {
      // In real implementation, call plusLogin API
      // const res = await apiService.memberLoginBySMS(this.phone, this.code);
      // if (res.code === 200) {
      //   await authStore.setPlusToken(res.data.plusToken);
      //   router.replaceUrl({ url: ROUTE_TABS });
      // }

      promptAction.showToast({ message: '会员登录功能开发中' });
    } catch (error) {
      hilog.error(0x0001, 'MemberLogin', 'SMS login failed: %{public}s', JSON.stringify(error));
      promptAction.showToast({ message: '登录失败，请检查验证码' });
    } finally {
      this.loading = false;
    }
  }

  aboutToDisappear() {
    if (this.countdownTimer !== -1) {
      clearInterval(this.countdownTimer);
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
