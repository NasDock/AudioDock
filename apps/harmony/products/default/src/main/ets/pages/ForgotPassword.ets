/**
 * Forgot Password Page
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import hilog from '@ohos.hilog';
import { apiService } from '@ohos/common';

// ==================== Forgot Password Page ====================
@Entry
@Component
struct ForgotPasswordPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State email: string = '';
  @State loading: boolean = false;
  @State step: 'input' | 'success' = 'input';

  build() {
    Column() {
      // Header
      Row() {
        Image($r('app.media.icon_back'))
          .width(24)
          .height(24)
          .onClick(() => router.back())

        Text('忘记密码')
          .fontSize(18)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.colors.text)

        Blank()
      }
      .width('100%')
      .padding({ left: 16, right: 16, top: 16 })
      .margin({ bottom: 32 })

      if (this.step === 'input') {
        this.buildInputStep()
      } else {
        this.buildSuccessStep()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
    .padding(24)
  }

  @Builder
  buildInputStep() {
    Column() {
      Text('重置密码')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)
        .width('100%')
        .margin({ bottom: 8 })

      Text('请输入您的注册邮箱，我们将发送密码重置链接')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .width('100%')
        .margin({ bottom: 32 })

      // Email input
      Column() {
        Text('邮箱地址')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.colors.text)
          .width('100%')
          .margin({ bottom: 8 })

        TextInput({ placeholder: '请输入邮箱地址', text: this.email })
          .width('100%')
          .height(50)
          .borderRadius(12)
          .border({ width: 1, color: this.colors.border })
          .backgroundColor(this.colors.card)
          .fontColor(this.colors.text)
          .fontSize(16)
          .placeholderColor(this.colors.secondary)
          .type(InputType.Email)
          .maxLines(1)
          .onChange((val) => this.email = val)
      }
      .width('100%')
      .margin({ bottom: 24 })

      // Submit button
      Button('发送重置链接')
        .width('100%')
        .height(50)
        .borderRadius(14)
        .backgroundColor(this.colors.primary)
        .fontColor('#FFFFFF')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .enabled(!this.loading)
        .onClick(() => this.handleSubmit())

      if (this.loading) {
        LoadingProgress()
          .width(24)
          .height(24)
          .margin({ top: 16 })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  buildSuccessStep() {
    Column() {
      Image($r('app.media.icon_success'))
        .width(80)
        .height(80)
        .margin({ top: 60, bottom: 24 })

      Text('发送成功')
        .fontSize(24)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Text(`密码重置链接已发送至\n${this.email}`)
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .textAlign(TextAlign.Center)
        .margin({ top: 12 })
        .width('100%')

      Button('返回登录')
        .width('100%')
        .height(50)
        .borderRadius(14)
        .backgroundColor(this.colors.primary)
        .fontColor('#FFFFFF')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .margin({ top: 40 })
        .onClick(() => router.back())
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  async handleSubmit() {
    if (!this.email) {
      promptAction.showToast({ message: '请输入邮箱地址' });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.email)) {
      promptAction.showToast({ message: '请输入有效的邮箱地址' });
      return;
    }

    this.loading = true;

    try {
      await apiService.forgotPassword(this.email);
      this.step = 'success';
    } catch (error) {
      hilog.error(0x0001, 'ForgotPassword', 'Password reset failed: %{public}s', JSON.stringify(error));
      promptAction.showToast({ message: '发送失败，请稍后重试' });
    } finally {
      this.loading = false;
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
