/**
 * Login Form Page - Server Connection & Authentication
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import hilog from '@ohos.hilog';
import { authStore } from '../store';
import { apiService } from '@ohos/common';
import { ROUTE_TABS } from '../constants/RouteConstants';

// ==================== Types ====================
enum LoginMode {
  SCAN = 'scan',
  MANUAL = 'manual'
}

interface ServerConfig {
  external: string;
  internal: string;
}

// ==================== Login Form Page ====================
@Entry
@Component
struct LoginFormPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State sourceType: string = 'AudioDock';
  @State isLogin: boolean = true;
  @State loginMode: LoginMode = LoginMode.MANUAL;
  @State isLoading: boolean = false;

  // Form fields
  @State externalAddress: string = '';
  @State internalAddress: string = '';
  @State username: string = '';
  @State password: string = '';
  @State confirmPassword: string = '';

  // Scan related
  @State scanSessionId: string = '';
  @State scanSecret: string = '';
  @State scanStatus: string = 'waiting_scan';

  aboutToAppear() {
    const params = router.getParams() as Record<string, string>;
    if (params?.type) {
      this.sourceType = params.type;
    }
    if (this.sourceType === 'AudioDock') {
      this.internalAddress = 'http://localhost:3000';
    }
  }

  build() {
    Column() {
      // Header with back button
      this.buildHeader()

      Scroll() {
        Column() {
          // Mode tabs (portrait only)
          this.buildModeTabs()

          // Content area
          if (this.loginMode === LoginMode.SCAN) {
            this.buildScanPanel()
          } else {
            this.buildManualForm()
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

      Text('切换类型')
        .fontSize(14)
        .fontColor(this.colors.text)
        .margin({ left: 8 })

      Blank()

      Text(this.sourceType)
        .fontSize(16)
        .fontColor(this.colors.text)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
  }

  @Builder
  buildModeTabs() {
    Row() {
      Row() {
        Text('扫码登录')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.loginMode === LoginMode.SCAN ? '#FFFFFF' : this.colors.text)
      }
      .layoutWeight(1)
      .height(40)
      .borderRadius(10)
      .backgroundColor(this.loginMode === LoginMode.SCAN ? this.colors.primary : this.colors.card)
      .onClick(() => this.loginMode = LoginMode.SCAN)

      Row() {
        Text('账号登录')
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.loginMode === LoginMode.MANUAL ? '#FFFFFF' : this.colors.text)
      }
      .layoutWeight(1)
      .height(40)
      .borderRadius(10)
      .backgroundColor(this.loginMode === LoginMode.MANUAL ? this.colors.primary : this.colors.card)
      .onClick(() => this.loginMode = LoginMode.MANUAL)
    }
    .width('100%')
    .height(44)
    .borderRadius(14)
    .border({
      width: 1,
      color: this.colors.border
    })
    .padding(4)
    .margin({ bottom: 24 })
  }

  @Builder
  buildScanPanel() {
    Column() {
      if (this.scanStatus === 'waiting_confirm') {
        this.buildWaitingConfirm()
      } else {
        this.buildQRCode()
      }
    }
    .width('100%')
    .padding(20)
    .backgroundColor(this.colors.card)
    .borderRadius(16)
  }

  @Builder
  buildWaitingConfirm() {
    Column() {
      Text('等待确认')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Text('请在手机上确认登录')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .margin({ top: 12 })

      LoadingProgress()
        .width(40)
        .height(40)
        .margin({ top: 24 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  buildQRCode() {
    Column() {
      Text('扫描登录')
        .fontSize(20)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Text('请使用 App 扫描下方二维码')
        .fontSize(14)
        .fontColor(this.colors.secondary)
        .margin({ top: 12 })

      // QR Code placeholder - actual implementation would use QR code component
      Column() {
        Text('二维码区域')
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

      Button('刷新二维码')
        .width('100%')
        .height(44)
        .borderRadius(14)
        .border({
          width: 1,
          color: this.colors.border
        })
        .backgroundColor(this.colors.card)
        .fontColor(this.colors.text)
        .margin({ top: 16 })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  buildManualForm() {
    Column() {
      // Server address section
      this.buildInputField('外网地址', this.externalAddress, (val) => this.externalAddress = val, 'http://music.example.com')
      this.buildInputField('内网地址', this.internalAddress, (val) => this.internalAddress = val, 'http://192.168.x.x:3000')

      // Username
      this.buildInputField('用户名', this.username, (val) => this.username = val, '请输入用户名')

      // Password
      this.buildInputField('密码', this.password, (val) => this.password = val, '请输入密码', true)

      // Confirm password (register only)
      if (!this.isLogin) {
        this.buildInputField('确认密码', this.confirmPassword, (val) => this.confirmPassword = val, '请再次输入密码', true)
      }

      // Submit button
      Button(this.isLogin ? '登录' : '注册')
        .width('100%')
        .height(50)
        .borderRadius(14)
        .backgroundColor(this.colors.primary)
        .fontColor('#FFFFFF')
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .margin({ top: 16 })
        .enabled(!this.isLoading)
        .onClick(() => this.handleSubmit())

      if (this.isLoading) {
        LoadingProgress()
          .width(24)
          .height(24)
          .margin({ top: 12 })
      }

      // Switch login/register
      Text(this.isLogin ? '没有账号？去注册' : '已有账号？去登录')
        .fontSize(14)
        .fontColor(this.colors.primary)
        .margin({ top: 16 })
        .onClick(() => this.isLogin = !this.isLogin)
    }
    .width('100%')
  }

  @Builder
  buildInputField(
    label: string,
    value: string,
    onChange: (val: string) => void,
    placeholder: string,
    isPassword: boolean = false
  ) {
    Column() {
      Text(label)
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.colors.text)
        .width('100%')
        .margin({ bottom: 8 })

      TextInput({ placeholder, text: value })
        .width('100%')
        .height(50)
        .borderRadius(12)
        .border({
          width: 1,
          color: this.colors.border
        })
        .backgroundColor(this.colors.card)
        .fontColor(this.colors.text)
        .fontSize(16)
        .placeholderColor(this.colors.secondary)
        .type(isPassword ? InputType.Password : InputType.Normal)
        .maxLines(1)
        .onChange((val) => onChange(val))
    }
    .width('100%')
    .margin({ bottom: 16 })
  }

  async handleSubmit() {
    // Validation
    if (!this.externalAddress && !this.internalAddress) {
      promptAction.showToast({ message: '请至少输入一个数据源地址' });
      return;
    }

    if (!this.username || !this.password) {
      promptAction.showToast({ message: '请填写用户名和密码' });
      return;
    }

    if (!this.isLogin && this.password !== this.confirmPassword) {
      promptAction.showToast({ message: '两次输入的密码不一致' });
      return;
    }

    this.isLoading = true;

    try {
      // Determine best server address
      const bestAddress = this.internalAddress || this.externalAddress;

      // Set server address
      await apiService.setBaseURL(bestAddress);

      // Login or register
      if (this.isLogin) {
        const success = await authStore.login(this.username, this.password);
        if (success) {
          router.replaceUrl({ url: ROUTE_TABS });
        }
      } else {
        promptAction.showToast({ message: '注册功能暂未实现' });
      }
    } catch (error) {
      hilog.error(0x0001, 'LoginForm', 'Login failed: %{public}s', JSON.stringify(error));
      promptAction.showToast({ message: '登录失败，请检查用户名和密码' });
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
