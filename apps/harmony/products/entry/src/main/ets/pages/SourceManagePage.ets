import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';
import { httpClient } from 'features_network';
import { authStore } from '../context/AuthStore';
import { buildTheme, CommonNavBar } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t } from 'features_i18n';

/**
 * 数据源管理页，对齐 mobile source-manage.tsx：
 * 按源类型（AudioDock / Subsonic / Emby）分组展示已保存的服务器配置，
 * 每条配置有内网/外网地址，支持展开编辑、连接、删除，底部添加新数据源。
 */

const SOURCE_TYPES: string[] = ['AudioDock', 'Subsonic', 'Emby'];
const SOURCE_TIPS: Record<string, string> = {
  'AudioDock': '所有支持 AudioDock 官方服务端',
  'Subsonic': '所有支持 Subsonic 协议的服务端，例如：Navidrome、Gonic 等',
  'Emby': '所有支持 Emby 协议的服务端',
};

class SourceConfig {
  id: string = '';
  internal: string = '';
  external: string = '';
  name: string = '';
}

@Entry
@Component
struct SourceManagePage {
  @State configs: Record<string, SourceConfig[]> = {};
  @State expandedIds: string[] = [];
  @State loadingId: string = '';
  @State loading: boolean = true;
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  // 举报弹窗状态
  @State reportDialogVisible: boolean = false;
  @State reportTitle: string = '';
  @State reportDescription: string = '';
  @State reportingKey: string = '';
  @State reportingId: string = '';
  @State reportSubmitting: boolean = false;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.loadAllConfigs();
  }

  onPageShow(): void {
    // 从添加/登录页返回时刷新列表（kvStore 数据可能在期间被写入）
    this.loadAllConfigs();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  private async loadAllConfigs(): Promise<void> {
    this.loading = true;
    const result: Record<string, SourceConfig[]> = {};
    for (const key of SOURCE_TYPES) {
      try {
        const raw = await kvStore.get(`sourceConfig_${key}`);
        if (raw !== null && raw.length > 0) {
          const parsed: Object = JSON.parse(raw);
          const list: SourceConfig[] = [];
          if (Array.isArray(parsed)) {
            const arr = parsed as Array<Record<string, string>>;
            for (const item of arr) {
              const cfg = new SourceConfig();
              cfg.id = item['id'] ?? Date.now().toString();
              cfg.internal = item['internal'] ?? '';
              cfg.external = item['external'] ?? '';
              cfg.name = item['name'] ?? '';
              list.push(cfg);
            }
          } else {
            // 迁移：旧对象格式转为数组（与 mobile 一致）
            const obj = parsed as Record<string, string>;
            const cfg = new SourceConfig();
            cfg.id = Date.now().toString();
            cfg.internal = obj['internal'] ?? '';
            cfg.external = obj['external'] ?? '';
            cfg.name = '默认服务器';
            list.push(cfg);
          }
          result[key] = list;
        } else {
          result[key] = [];
        }
      } catch (e) {
        result[key] = [];
      }
    }
    this.configs = result;
    this.loading = false;
  }

  private async saveConfig(key: string): Promise<void> {
    const list = this.configs[key] ?? [];
    const data = JSON.stringify(list);
    await kvStore.set(`sourceConfig_${key}`, data);
  }

  private applyConfigs(key: string, list: SourceConfig[]): void {
    const next: Record<string, SourceConfig[]> = {};
    for (const k of SOURCE_TYPES) {
      next[k] = this.configs[k] ?? [];
    }
    next[key] = list;
    this.configs = next;
  }

  private updateConfig(key: string, id: string, field: string, value: string): void {
    const list = this.configs[key] ?? [];
    const updated: SourceConfig[] = list.map((item: SourceConfig) => {
      if (item.id === id) {
        const copy = new SourceConfig();
        copy.id = item.id;
        copy.internal = field === 'internal' ? value : item.internal;
        copy.external = field === 'external' ? value : item.external;
        copy.name = field === 'name' ? value : item.name;
        return copy;
      }
      return item;
    });
    this.applyConfigs(key, updated);
  }

  private async deleteConfig(key: string, id: string): Promise<void> {
    const list = (this.configs[key] ?? []).filter((item: SourceConfig) => item.id !== id);
    this.applyConfigs(key, list);
    await this.saveConfig(key);
    promptAction.showToast({ message: '已删除' });
  }

  private openReportDialog(key: string, id: string): void {
    this.reportingKey = key;
    this.reportingId = id;
    this.reportTitle = '';
    this.reportDescription = '';
    this.reportDialogVisible = true;
  }

  private closeReportDialog(): void {
    this.reportDialogVisible = false;
    this.reportingKey = '';
    this.reportingId = '';
    this.reportTitle = '';
    this.reportDescription = '';
    this.reportSubmitting = false;
  }

  // 提交举报（按用户要求：总是弹窗提示举报成功，不发真实接口）
  // 加 1s loading 模拟提交过程再提示成功。
  private submitReport(): void {
    const title = this.reportTitle.trim();
    const desc = this.reportDescription.trim();
    if (title.length === 0 || desc.length === 0) {
      promptAction.showToast({ message: t('sourceManage.reportRequired') });
      return;
    }
    if (this.reportSubmitting) return;
    this.reportSubmitting = true;
    setTimeout(() => {
      this.reportSubmitting = false;
      this.closeReportDialog();
      promptAction.showDialog({
        title: t('sourceManage.reportSuccess'),
        message: '',
        buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
      });
    }, 1000);
  }

  private isExpanded(id: string): boolean {
    return this.expandedIds.indexOf(id) >= 0;
  }

  private toggleExpand(id: string): void {
    if (this.isExpanded(id)) {
      this.expandedIds = this.expandedIds.filter((x: string) => x !== id);
    } else {
      this.expandedIds = [...this.expandedIds, id];
    }
  }

  private connectLabel(cfg: SourceConfig): string {
    if (cfg.internal.length > 0 && cfg.external.length > 0) return '自动连接';
    if (cfg.internal.length > 0) return '内网连接';
    if (cfg.external.length > 0) return '外网连接';
    return '连接';
  }

  private async handleConnect(key: string, cfg: SourceConfig): Promise<void> {
    if (cfg.internal.length === 0 && cfg.external.length === 0) {
      promptAction.showToast({ message: '请至少输入一个地址' });
      return;
    }
    this.loadingId = cfg.id;
    try {
      await this.saveConfig(key);
      // 优先内网，失败则尝试外网
      let address = '';
      if (cfg.internal.length > 0) {
        const ok = await this.checkConnectivity(cfg.internal);
        if (ok) address = cfg.internal;
      }
      if (address.length === 0 && cfg.external.length > 0) {
        const ok = await this.checkConnectivity(cfg.external);
        if (ok) address = cfg.external;
      }
      if (address.length === 0) {
        // 无法探测时直接使用外网或内网
        address = cfg.external.length > 0 ? cfg.external : cfg.internal;
      }
      await authStore.switchServer(address);
      await kvStore.set('selectedSourceType', key.toLowerCase());
      promptAction.showToast({ message: `已连接到 ${key}` });
      router.back();
    } catch (e) {
      Logger.w('SourceManage', `connect failed: ${String(e)}`);
      promptAction.showToast({ message: '连接失败，请检查地址' });
    } finally {
      this.loadingId = '';
    }
  }

  private async checkConnectivity(url: string): Promise<boolean> {
    try {
      const original = httpClient.getBaseURL();
      httpClient.setBaseURL(url);
      await httpClient.get<string>('/ping');
      httpClient.setBaseURL(original);
      return true;
    } catch (e) {
      return false;
    }
  }

  build() {
    Stack() {
      Column() {
        CommonNavBar({ title: '切换数据源', theme: this.theme, onBack: () => router.back() })

        if (this.loading) {
          Column() {
            LoadingProgress().width(32).height(32).color(this.theme.colors.primary)
            Text('加载中...').fontSize(14).fontColor(this.theme.colors.textSecondary).margin({ top: 12 })
          }
          .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
        } else {
          Scroll() {
            Column({ space: 15 }) {
              Text('Wi-Fi 环境下优先选择内网，移动网络环境下只选择外网')
                .fontSize(13).fontColor(this.theme.colors.textSecondary)

              ForEach(SOURCE_TYPES, (key: string) => {
                if ((this.configs[key] ?? []).length > 0) {
                  ForEach(this.configs[key] ?? [], (cfg: SourceConfig) => {
                    this.ConfigCard(key, cfg)
                  }, (cfg: SourceConfig) => cfg.id)
                }
              }, (key: string) => key)

              // 添加数据源
              Row({ space: 8 }) {
                Text('+').fontSize(18).fontColor(this.theme.colors.primary)
                Text('添加数据源').fontSize(15).fontColor(this.theme.colors.primary)
              }
              .width('100%')
              .padding(16)
              .borderRadius(12)
              .border({ width: 1, color: this.theme.colors.border })
              .backgroundColor(this.theme.colors.surface)
              .justifyContent(FlexAlign.Center)
              .onClick(() => router.pushUrl({ url: 'pages/SourceSelectPage' }))
            }
            .width('100%')
            .padding(16)
          }
          .layoutWeight(1)
          .scrollBar(BarState.Off)
          .edgeEffect(EdgeEffect.Spring)
          .align(Alignment.Top)
        }
      }
      .width('100%').height('100%')
      .backgroundColor(this.theme.colors.background)

      // 举报弹窗（覆盖全屏）
      if (this.reportDialogVisible) {
        this.ReportDialog()
      }
    }
    .width('100%').height('100%')
  }

  @Builder
  ConfigCard(key: string, cfg: SourceConfig) {
    Column() {
      // 头部：类型名 + tips + 展开/收起
      Row() {
        Column({ space: 2 }) {
          Text(key).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
          Text(SOURCE_TIPS[key] ?? '').fontSize(12).fontColor(this.theme.colors.textSecondary)
        }
        .layoutWeight(1).alignItems(HorizontalAlign.Start)

        if (cfg.internal.length > 0 || cfg.external.length > 0) {
          Text(this.isExpanded(cfg.id) ? '▲' : '▼')
            .fontSize(14).fontColor(this.theme.colors.textSecondary)
            .onClick(() => this.toggleExpand(cfg.id))
        }
      }
      .width('100%')
      .onClick(() => {
        if (cfg.internal.length > 0 || cfg.external.length > 0) this.toggleExpand(cfg.id);
      })

      // 展开区域：内网/外网地址输入
      if (this.isExpanded(cfg.id)) {
        Column({ space: 12 }) {
          Column({ space: 4 }) {
            Text('内网地址').fontSize(13).fontColor(this.theme.colors.textSecondary)
            TextInput({ text: cfg.internal, placeholder: 'http://192.168.x.x:port' })
              .fontSize(14)
              .fontColor(this.theme.colors.text)
              .placeholderColor(this.theme.colors.textSecondary)
              .backgroundColor(this.theme.colors.background)
              .borderRadius(8)
              .border({ width: 1, color: this.theme.colors.border })
              .padding({ left: 12, right: 12, top: 10, bottom: 10 })
              .onChange((val: string) => this.updateConfig(key, cfg.id, 'internal', val))
          }
          .width('100%').alignItems(HorizontalAlign.Start)

          Column({ space: 4 }) {
            Text('外网地址').fontSize(13).fontColor(this.theme.colors.textSecondary)
            TextInput({ text: cfg.external, placeholder: 'https://example.com' })
              .fontSize(14)
              .fontColor(this.theme.colors.text)
              .placeholderColor(this.theme.colors.textSecondary)
              .backgroundColor(this.theme.colors.background)
              .borderRadius(8)
              .border({ width: 1, color: this.theme.colors.border })
              .padding({ left: 12, right: 12, top: 10, bottom: 10 })
              .onChange((val: string) => this.updateConfig(key, cfg.id, 'external', val))
          }
          .width('100%').alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .margin({ top: 12 })
      }

      // 操作行：删除 + 举报 + 连接
      Row({ space: 8 }) {
        // 删除按钮：删除图标
        Column() {
          SymbolGlyph($r('sys.symbol.trash'))
            .fontSize(18)
            .fontColor(['#FFFFFF'])
        }
        .width(40).height(36).borderRadius(8)
        .backgroundColor('#FF4444')
        .justifyContent(FlexAlign.Center)
        .onClick(() => this.deleteConfig(key, cfg.id))

        // 举报按钮：文字（原感叹号图标已改为文字展示）
        Column() {
          Text(t('sourceManage.reportDataSource'))
            .fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor('#FFFFFF')
        }
        .height(36).borderRadius(8)
        .padding({ left: 10, right: 10 })
        .backgroundColor('#FF9500')
        .justifyContent(FlexAlign.Center)
        .accessibilityText(t('sourceManage.reportDataSource'))
        .onClick(() => this.openReportDialog(key, cfg.id))

        Column() {
          if (this.loadingId === cfg.id) {
            LoadingProgress().width(20).height(20).color(this.theme.colors.onPrimary)
          } else {
            Text(this.connectLabel(cfg))
              .fontSize(14).fontWeight(FontWeight.Medium)
              .fontColor(this.theme.colors.onPrimary)
          }
        }
        .layoutWeight(1).height(36).borderRadius(8)
        .backgroundColor(this.theme.colors.primary)
        .justifyContent(FlexAlign.Center)
        .opacity(this.loadingId === cfg.id ? 0.6 : 1)
        .onClick(() => {
          if (this.loadingId === '') this.handleConnect(key, cfg);
        })
      }
      .width('100%')
      .margin({ top: 12 })
    }
    .width('100%')
    .padding(16)
    .borderRadius(12)
    .border({ width: 1, color: this.theme.colors.border })
    .backgroundColor(this.theme.colors.surface)
  }

  // 举报弹窗（中间位置）
  @Builder
  ReportDialog() {
    Stack() {
      // 半透明遮罩
      Column()
        .width('100%').height('100%')
        .backgroundColor('rgba(0, 0, 0, 0.5)')
        .onClick(() => this.closeReportDialog())

      // 表单卡片
      Column({ space: 12 }) {
        Text(t('sourceManage.reportDataSource'))
          .fontSize(17).fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .width('100%')
          .textAlign(TextAlign.Start)

        Column({ space: 6 }) {
          Text(t('sourceManage.reportTitle'))
            .fontSize(13)
            .fontColor(this.theme.colors.textSecondary)
            .width('100%')
            .textAlign(TextAlign.Start)
          TextInput({ text: this.reportTitle, placeholder: t('sourceManage.reportTitlePlaceholder') })
            .fontSize(14)
            .fontColor(this.theme.colors.text)
            .placeholderColor(this.theme.colors.textSecondary)
            .backgroundColor(this.theme.colors.background)
            .borderRadius(8)
            .border({ width: 1, color: this.theme.colors.border })
            .padding({ left: 12, right: 12, top: 10, bottom: 10 })
            .width('100%')
            .maxLength(50)
            .onChange((val: string) => { this.reportTitle = val; })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        Column({ space: 6 }) {
          Text(t('sourceManage.reportDescription'))
            .fontSize(13)
            .fontColor(this.theme.colors.textSecondary)
            .width('100%')
            .textAlign(TextAlign.Start)
          TextInput({ text: this.reportDescription, placeholder: t('sourceManage.reportDescriptionPlaceholder') })
            .fontSize(14)
            .fontColor(this.theme.colors.text)
            .placeholderColor(this.theme.colors.textSecondary)
            .backgroundColor(this.theme.colors.background)
            .borderRadius(8)
            .border({ width: 1, color: this.theme.colors.border })
            .padding({ left: 12, right: 12, top: 10, bottom: 10 })
            .width('100%')
            .height(96)
            .maxLength(500)
            .onChange((val: string) => { this.reportDescription = val; })
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)

        // 操作行：取消 + 提交
        Row({ space: 10 }) {
          Column() {
            Text(t('sourceManage.reportCancel'))
              .fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.theme.colors.text)
          }
          .layoutWeight(1).height(40).borderRadius(8)
          .backgroundColor(this.theme.colors.border)
          .justifyContent(FlexAlign.Center)
          .onClick(() => this.closeReportDialog())

          Column() {
            if (this.reportSubmitting) {
              LoadingProgress().width(20).height(20).color(this.theme.colors.onPrimary)
            } else {
              Text(t('sourceManage.reportSubmit'))
                .fontSize(15).fontWeight(FontWeight.Medium)
                .fontColor(this.theme.colors.onPrimary)
            }
          }
          .layoutWeight(1).height(40).borderRadius(8)
          .backgroundColor(this.theme.colors.primary)
          .justifyContent(FlexAlign.Center)
          .opacity(this.reportSubmitting ? 0.7 : 1)
          .onClick(() => this.submitReport())
        }
        .width('100%')
        .margin({ top: 4 })
      }
      .width('90%')
      .padding(20)
      .borderRadius(14)
      .backgroundColor(this.theme.colors.surface)
      .border({ width: 1, color: this.theme.colors.border })
    }
    .width('100%').height('100%')
    .backgroundColor(this.theme.colors.background)
    // 沉浸式避让：全屏布局下页面从物理 y=0 排版，根容器 padding 避开状态栏/小横条
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }
}
