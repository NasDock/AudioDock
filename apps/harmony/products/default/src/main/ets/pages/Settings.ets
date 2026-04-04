/**
 * Settings Page
 * AudioDock HarmonyOS App
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { settingsStore, SettingsState, ThemeMode, ContentMode, authStore } from '../store';
import { apiService } from '@ohos/common';

// ==================== Theme Colors ====================
class ThemeColors {
  background: string = '#FFFFFF';
  card: string = '#F5F5F5';
  text: string = '#000000';
  secondary: string = '#666666';
  border: string = '#E0E0E0';
  primary: string = '#007AFF';
}

// ==================== Settings Item Type ====================
interface SettingsItem {
  icon: string;
  title: string;
  value: string;
}

// ==================== Action Menu Types ====================
interface ActionMenuResult {
  index: number;
}

interface ActionMenuButton {
  text: string;
  color: string;
}

// ==================== Settings Page ====================
@Entry
@Component
struct SettingsPage {
  @StorageLink('theme_colors') colors: ThemeColors = new ThemeColors();
  @State settings: SettingsState = {
    theme: ThemeMode.SYSTEM,
    autoOrientation: true,
    carLayoutMode: false,
    voiceAssistantEnabled: false,
    contentMode: ContentMode.MUSIC,
    sleepTimerMinutes: null,
    equalizerPreset: 'normal',
    lyricsFontSize: 16,
    downloadQuality: 'high',
    cacheSize: 500 * 1024 * 1024,
    autoDownload: false,
    notifyOnUpdate: true,
    language: 'zh-CN',
    serverAddress: ''
  };
  @State serverAddress: string = '';

  aboutToAppear() {
    this.loadSettings();
  }

  loadSettings() {
    const state = settingsStore.getState();
    this.settings = state;
    this.serverAddress = state.serverAddress;
  }

  build() {
    Column() {
      this.buildHeader()

      Scroll() {
        Column() {
          this.buildServerSection()
          this.buildPlaybackSection()
          this.buildDisplaySection()
          this.buildDownloadSection()
          this.buildAboutSection()

          Button('退出登录')
            .width('90%')
            .height(50)
            .borderRadius(14)
            .backgroundColor('#FFE4E4')
            .fontColor('#FF4444')
            .fontSize(16)
            .fontWeight(FontWeight.Medium)
            .margin({ top: 24 })
            .onClick(() => this.handleLogout())

          Text('').height(80)
        }
        .width('100%')
        .padding({ bottom: 80 })
      }
      .layoutWeight(1)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.colors.background)
  }

  @Builder
  buildHeader(): void {
    Row() {
      Image($r('app.media.icon_back'))
        .width(24)
        .height(24)
        .fillColor(this.colors.text)
        .onClick(() => router.back())

      Text('设置')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.colors.text)

      Blank()
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
    .height(56)
  }

  @Builder
  buildServerSection(): void {
    Column() {
      Text('服务器')
        .fontSize(12)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding({ left: 20, top: 20, bottom: 8 })

      Column() {
        this.buildSettingsItem('🌐', '服务器地址', this.serverAddress || '未设置', () => this.handleChangeServer())
      }
      .width('100%')
      .backgroundColor(this.colors.card)
    }
    .width('100%')
    .padding({ left: 16, right: 16 })
  }

  @Builder
  buildPlaybackSection(): void {
    Column() {
      Text('播放设置')
        .fontSize(12)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding({ left: 20, top: 20, bottom: 8 })

      Column() {
        this.buildSettingsItem('🎵', '内容模式', this.settings.contentMode === 'MUSIC' ? '音乐' : '有声书', () => this.handleToggleContentMode())
        Divider().padding({ left: 46 })
        this.buildSettingsItem('📱', '自动旋转屏幕', this.settings.autoOrientation ? '开' : '关', () => this.handleToggleAutoOrientation())
        Divider().padding({ left: 46 })
        this.buildSettingsItem('🚗', '车载布局', this.settings.carLayoutMode ? '开' : '关', () => this.handleToggleCarLayout())
      }
      .width('100%')
      .backgroundColor(this.colors.card)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
  }

  @Builder
  buildDisplaySection(): void {
    Column() {
      Text('显示设置')
        .fontSize(12)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding({ left: 20, top: 20, bottom: 8 })

      Column() {
        this.buildSettingsItem('🎨', '主题', this.getThemeName(), () => this.handleChangeTheme())
        Divider().padding({ left: 46 })
        this.buildSettingsItem('🔤', '歌词字体大小', `${this.settings.lyricsFontSize || 16}px`, () => this.handleChangeLyricsFontSize())
      }
      .width('100%')
      .backgroundColor(this.colors.card)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
  }

  @Builder
  buildDownloadSection(): void {
    Column() {
      Text('下载设置')
        .fontSize(12)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding({ left: 20, top: 20, bottom: 8 })

      Column() {
        this.buildSettingsItem('⬇️', '下载音质', this.settings.downloadQuality || '高', () => this.handleChangeDownloadQuality())
        Divider().padding({ left: 46 })
        this.buildSettingsItem('📡', '自动下载', this.settings.autoDownload ? '开' : '关', () => this.handleToggleAutoDownload())
      }
      .width('100%')
      .backgroundColor(this.colors.card)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
  }

  @Builder
  buildAboutSection(): void {
    Column() {
      Text('关于')
        .fontSize(12)
        .fontColor(this.colors.secondary)
        .width('100%')
        .padding({ left: 20, top: 20, bottom: 8 })

      Column() {
        this.buildSettingsItem('ℹ️', '版本信息', '1.0.0', () => {})
        Divider().padding({ left: 46 })
        this.buildSettingsItem('📝', '检查更新', '', () => promptAction.showToast({ message: '已是最新版本' }))
        Divider().padding({ left: 46 })
        this.buildSettingsItem('📜', '用户协议', '', () => promptAction.showToast({ message: '用户协议功能开发中' }))
        Divider().padding({ left: 46 })
        this.buildSettingsItem('🔒', '隐私政策', '', () => promptAction.showToast({ message: '隐私政策功能开发中' }))
      }
      .width('100%')
      .backgroundColor(this.colors.card)
    }
    .width('100%')
    .padding({ left: 16, right: 16, top: 16 })
  }

  @Builder
  buildSettingsItem(icon: string, title: string, value: string, onClick: () => void): void {
    Row() {
      Text(icon)
        .fontSize(18)
        .margin({ right: 12 })

      Text(title)
        .fontSize(15)
        .fontColor(this.colors.text)
        .layoutWeight(1)

      Text(value)
        .fontSize(14)
        .fontColor(this.colors.secondary)

      Image($r('app.media.icon_chevron_right'))
        .width(16)
        .height(16)
        .fillColor(this.colors.secondary)
        .margin({ left: 8 })
    }
    .width('100%')
    .padding({ top: 14, bottom: 14, left: 20, right: 20 })
    .onClick(onClick)
  }

  async handleToggleContentMode() {
    await settingsStore.toggleContentMode();
    this.loadSettings();
    promptAction.showToast({ message: `已切换到${this.settings.contentMode === 'MUSIC' ? '音乐' : '有声书'}模式` });
  }

  async handleToggleAutoOrientation() {
    await settingsStore.setAutoOrientation(!this.settings.autoOrientation);
    this.loadSettings();
  }

  async handleToggleCarLayout() {
    await settingsStore.setCarLayoutMode(!this.settings.carLayoutMode);
    this.loadSettings();
  }

  async handleToggleAutoDownload() {
    await settingsStore.setAutoDownload(!this.settings.autoDownload);
    this.loadSettings();
  }

  handleChangeTheme() {
    const themes: string[] = ['系统', '浅色', '深色', '节日'];
    const modes: ThemeMode[] = [ThemeMode.SYSTEM, ThemeMode.LIGHT, ThemeMode.DARK, ThemeMode.FESTIVE];
    const buttons: ActionMenuButton[] = [
      { text: themes[0], color: this.colors.text },
      { text: themes[1], color: this.colors.text },
      { text: themes[2], color: this.colors.text },
      { text: themes[3], color: this.colors.text }
    ];
    promptAction.showActionMenu({
      title: '选择主题',
      buttons: buttons
    }).then((result: ActionMenuResult) => {
      if (result.index >= 0 && result.index < modes.length) {
        settingsStore.setTheme(modes[result.index]);
        this.loadSettings();
      }
    }).catch((err: Error) => {});
  }

  handleChangeServer() {
    promptAction.showToast({ message: '服务器设置功能开发中' });
  }

  handleChangeLyricsFontSize() {
    promptAction.showToast({ message: '歌词字体大小功能开发中' });
  }

  handleChangeDownloadQuality() {
    const qualities: string[] = ['标准', '高', '极高', '无损'];
    const buttons: ActionMenuButton[] = [
      { text: qualities[0], color: this.colors.text },
      { text: qualities[1], color: this.colors.text },
      { text: qualities[2], color: this.colors.text },
      { text: qualities[3], color: this.colors.text }
    ];
    promptAction.showActionMenu({
      title: '下载音质',
      buttons: buttons
    }).then((result: ActionMenuResult) => {
      if (result.index >= 0 && result.index < qualities.length) {
        settingsStore.setDownloadQuality(qualities[result.index]);
        this.loadSettings();
      }
    }).catch((err: Error) => {});
  }

  getThemeName(): string {
    switch (this.settings.theme) {
      case ThemeMode.LIGHT: return '浅色';
      case ThemeMode.DARK: return '深色';
      case ThemeMode.FESTIVE: return '节日';
      default: return '系统';
    }
  }

  async handleLogout() {
    try {
      await authStore.logout();
      await apiService.clearTokens();
      promptAction.showToast({ message: '已退出登录' });
      router.back();
    } catch (e) {
      promptAction.showToast({ message: '退出失败' });
    }
  }
}
