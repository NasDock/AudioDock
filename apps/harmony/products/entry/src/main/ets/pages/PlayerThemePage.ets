/**
 * 播放器主题管理页（对齐 mobile app/player-theme.tsx）。
 *
 * - 主题列表：默认样式 + 已导入主题（单选激活、编辑、删除）；
 * - 导入：粘贴 JSON（schema 与 mobile 完全对齐，meta.platform 接受 "mobile"/"hm"）；
 * - 编辑：半模态预填原始 JSON（rawJson，unknown 键不丢），保存走同一套校验原位更新；
 * - 非会员仅提示横幅（VIP 门槛在 PlayerPage 消费侧生效，对齐 mobile）。
 */
import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import pasteboard from '@ohos.pasteboard';
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { playerThemeStore } from '../theme/playerThemeStore';
import type { PlayerThemePlugin } from '../theme/playerThemeSchema';

const TAG = 'PlayerThemePage';

@Entry
@Component
struct PlayerThemePage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  @State private langAtBuild: string = getLang();
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  @State private isVip: boolean = false;
  /** 列表渲染快照：store 通知时整体替换（对齐 PlayerStore 消费模式） */
  @State private themeOrder: string[] = [];
  @State private themeMap: Record<string, PlayerThemePlugin> = {};
  @State private activeId: string | null = null;

  @State private jsonText: string = '';
  /** 编辑态：editingId 非空时打开编辑半模态，editText 预填原始 JSON */
  @State private editingId: string = '';
  @State private editText: string = '';
  @State private showEditSheet: boolean = false;

  private unsubTheme: (() => void) | null = null;

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.unsubTheme = playerThemeStore.subscribe((): void => this.refreshList());
    playerThemeStore.hydrate()
      .then((): void => this.refreshList())
      .catch(() => undefined);
    this.loadVipStatus().catch(() => undefined);
  }

  aboutToDisappear(): void {
    if (this.unsubTheme) this.unsubTheme();
  }

  private refreshList(): void {
    this.themeOrder = [...playerThemeStore.getOrder()];
    this.themeMap = playerThemeStore.getThemes();
    this.activeId = playerThemeStore.getActiveId();
  }

  /** 与 mobile usePlayerTheme 同一口径的本地 VIP 判定 */
  private async loadVipStatus(): Promise<void> {
    try {
      const status = await kvStore.get('plus_vip_status');
      let vip = status === 'true';
      if (!vip) {
        const data = await kvStore.get('plus_vip_data');
        if (data !== null) {
          try {
            const parsed = JSON.parse(data) as Record<string, Object>;
            vip = !!parsed['vipTier'] && parsed['vipTier'] !== 'NONE';
          } catch {}
        }
      }
      this.isVip = vip;
    } catch (e) {
      Logger.w(TAG, `loadVipStatus failed: ${String(e)}`);
    }
  }

  private handleImport(): void {
    const text = this.jsonText.trim();
    if (text.length === 0) return;
    const result = playerThemeStore.importTheme(text);
    if (!result.ok) {
      this.showResultDialog(t('common.error'), result.error);
      return;
    }
    this.jsonText = '';
    this.showImportResult(result.warnings, t('settings.playerThemeImportSuccess'));
  }

  private showImportResult(warnings: string[], okMessage: string): void {
    if (warnings.length > 0) {
      this.showResultDialog(
        t('settings.playerThemeImportWarnings'),
        warnings.slice(0, 10).join('\n'),
      );
    } else {
      promptAction.showToast({ message: okMessage });
    }
  }

  private showResultDialog(title: string, message: string): void {
    promptAction.showDialog({
      title,
      message,
      buttons: [{ text: t('common.confirm'), color: '#007DFF' }],
    }).catch(() => undefined);
  }

  private async handlePaste(): Promise<void> {
    try {
      const pb = pasteboard.getSystemPasteboard();
      const data = await pb.getData();
      const text = data.getPrimaryText();
      if (text.length > 0) this.jsonText = text;
    } catch (e) {
      Logger.w(TAG, `read pasteboard failed: ${String(e)}`);
    }
  }

  private handleDelete(id: string): void {
    promptAction.showDialog({
      title: t('settings.playerThemeDeleteConfirm'),
      buttons: [
        { text: t('common.cancel'), color: '#888888' },
        { text: t('common.confirm'), color: '#E53935' },
      ],
    })
      .then((res: promptAction.ShowDialogSuccessResponse): void => {
        if (res.index === 1) playerThemeStore.removeTheme(id);
      })
      .catch(() => undefined);
  }

  private handleStartEdit(id: string): void {
    const plugin = this.themeMap[id];
    if (plugin === undefined) return;
    // 预填原始 JSON（含 unknown 键），格式化展示
    try {
      this.editText = JSON.stringify(JSON.parse(plugin.rawJson), null, 2);
    } catch {
      this.editText = plugin.rawJson;
    }
    this.editingId = id;
    this.showEditSheet = true;
  }

  private handleSaveEdit(): void {
    const text = this.editText.trim();
    if (this.editingId.length === 0 || text.length === 0) return;
    const result = playerThemeStore.updateTheme(this.editingId, text);
    if (!result.ok) {
      this.showResultDialog(t('common.error'), result.error);
      return;
    }
    this.showEditSheet = false;
    this.editingId = '';
    this.editText = '';
    this.showImportResult(result.warnings, t('settings.playerThemeUpdateSuccess'));
  }

  build() {
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
      // Header（对齐 SettingsPage 样式）
      Row() {
        Button() {
          Text('‹')
            .fontSize(28)
            .fontColor(this.theme.colors.text)
        }
        .width(40)
        .height(40)
        .backgroundColor(Color.Transparent)
        .onClick((): void => router.back())

        Text(t('settings.playerTheme'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(40).height(40)
      }
      .width('100%')
      .padding({ left: 15, right: 15, top: 16, bottom: 15 })

      Scroll() {
        Column({ space: 12 }) {
          Text(t('settings.playerThemeDescription'))
            .fontSize(13)
            .fontColor(this.theme.colors.textSecondary)
            .width('100%')

          // 非会员提示（对齐 mobile vipBanner）
          if (!this.isVip) {
            Row({ space: 8 }) {
              Text('💎')
                .fontSize(16)
              Text(t('settings.playerThemeVipOnly'))
                .fontSize(13)
                .fontColor(this.theme.colors.textSecondary)
                .layoutWeight(1)
            }
            .width('100%')
            .padding(12)
            .borderRadius(10)
            .border({ width: 1, color: this.theme.colors.border })
            .backgroundColor(this.theme.colors.card)
          }

          // ─── 主题列表 ───
          Column() {
            // 默认样式
            Row() {
              Text(this.activeId === null ? '◉' : '○')
                .fontSize(20)
                .fontColor(this.activeId === null ? this.theme.colors.primary : this.theme.colors.textSecondary)
                .width(28)
              Column({ space: 2 }) {
                Text(t('settings.playerThemeDefault'))
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.theme.colors.text)
                Text(t('settings.playerThemeDefaultDescription'))
                  .fontSize(12)
                  .fontColor(this.theme.colors.textSecondary)
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              .margin({ left: 10 })
            }
            .width('100%')
            .padding({ top: 12, bottom: 12 })
            .onClick((): void => playerThemeStore.setActive(null))

            ForEach(this.themeOrder, (id: string) => {
              Row() {
                Text(this.activeId === id ? '◉' : '○')
                  .fontSize(20)
                  .fontColor(this.activeId === id ? this.theme.colors.primary : this.theme.colors.textSecondary)
                  .width(28)
                Column({ space: 2 }) {
                  Text(this.themeMap[id]?.meta.name ?? '')
                    .fontSize(15)
                    .fontWeight(FontWeight.Medium)
                    .fontColor(this.theme.colors.text)
                  if (this.themeMap[id]?.meta.description !== undefined) {
                    Text(this.themeMap[id]?.meta.description ?? '')
                      .fontSize(12)
                      .fontColor(this.theme.colors.textSecondary)
                  }
                }
                .layoutWeight(1)
                .alignItems(HorizontalAlign.Start)
                .margin({ left: 10 })

                Text('✎')
                  .fontSize(18)
                  .fontColor(this.theme.colors.textSecondary)
                  .width(36)
                  .height(36)
                  .textAlign(TextAlign.Center)
                  .onClick((): void => this.handleStartEdit(id))
                Text('🗑')
                  .fontSize(16)
                  .fontColor(this.theme.colors.textSecondary)
                  .width(36)
                  .height(36)
                  .textAlign(TextAlign.Center)
                  .onClick((): void => this.handleDelete(id))
              }
              .width('100%')
              .padding({ top: 12, bottom: 12 })
              .borderWidth({ top: 0.5 })
              .borderColor(this.theme.colors.border)
              .onClick((): void => playerThemeStore.setActive(id))
            }, (id: string) => id)

            if (this.themeOrder.length === 0) {
              Text(t('settings.playerThemeEmpty'))
                .fontSize(13)
                .fontColor(this.theme.colors.textSecondary)
                .width('100%')
                .textAlign(TextAlign.Center)
                .padding({ top: 12, bottom: 12 })
                .borderWidth({ top: 0.5 })
                .borderColor(this.theme.colors.border)
            }
          }
          .width('100%')
          .padding({ left: 12, right: 12 })
          .borderRadius(12)
          .border({ width: 1, color: this.theme.colors.border })
          .backgroundColor(this.theme.colors.card)

          // ─── 导入：粘贴 JSON ───
          Column({ space: 10 }) {
            TextArea({ text: this.jsonText, placeholder: t('settings.playerThemeImportPlaceholder') })
              .width('100%')
              .height(140)
              .fontSize(12)
              .fontColor(this.theme.colors.text)
              .placeholderColor(this.theme.colors.textSecondary)
              .backgroundColor(this.theme.colors.background)
              .border({ width: 1, color: this.theme.colors.border })
              .borderRadius(8)
              .onChange((v: string): void => {
                this.jsonText = v;
              })

            Row({ space: 10 }) {
              Row({ space: 6 }) {
                Text('📋')
                  .fontSize(14)
                Text(t('settings.playerThemePaste'))
                  .fontSize(13)
                  .fontColor(this.theme.colors.text)
              }
              .padding({ left: 12, right: 12, top: 8, bottom: 8 })
              .borderRadius(8)
              .border({ width: 1, color: this.theme.colors.border })
              .onClick((): void => {
                this.handlePaste().catch(() => undefined);
              })

              Text(t('settings.playerThemeImport'))
                .fontSize(13)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.theme.colors.background)
                .padding({ left: 12, right: 12, top: 8, bottom: 8 })
                .borderRadius(8)
                .backgroundColor(this.theme.colors.primary)
                .opacity(this.jsonText.trim().length === 0 ? 0.4 : 1)
                .onClick((): void => this.handleImport())
            }
            .width('100%')
            .justifyContent(FlexAlign.End)
          }
          .width('100%')
          .padding(12)
          .borderRadius(12)
          .border({ width: 1, color: this.theme.colors.border })
          .backgroundColor(this.theme.colors.card)
        }
        .width('100%')
        .padding(16)
      }
      .layoutWeight(1)
      .width('100%')
    }
    .width('100%').height('100%')
    // 编辑半模态：预填原始 JSON，保存走与导入同一套校验（原位更新，保留激活态）
    .bindSheet($$this.showEditSheet, this.editSheet(), {
      height: SheetSize.LARGE,
      dragBar: true,
      backgroundColor: this.theme.colors.surface,
      preferType: SheetType.BOTTOM,
    })
  }

  @Builder
  editSheet() {
    Column({ space: 12 }) {
      Text(t('settings.playerThemeEditTitle'))
        .fontSize(16)
        .fontWeight(FontWeight.Bold)
        .fontColor(this.theme.colors.text)
        .margin({ top: 8 })

      TextArea({ text: this.editText })
        .width('100%')
        .height(320)
        .fontSize(12)
        .fontColor(this.theme.colors.text)
        .backgroundColor(this.theme.colors.background)
        .border({ width: 1, color: this.theme.colors.border })
        .borderRadius(8)
        .onChange((v: string): void => {
          this.editText = v;
        })

      Row({ space: 10 }) {
        Text(t('common.cancel'))
          .fontSize(14)
          .fontColor(this.theme.colors.text)
          .padding({ left: 20, right: 20, top: 10, bottom: 10 })
          .borderRadius(10)
          .border({ width: 1, color: this.theme.colors.border })
          .onClick((): void => {
            this.showEditSheet = false;
          })
        Text(t('settings.playerThemeSave'))
          .fontSize(14)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.theme.colors.background)
          .padding({ left: 20, right: 20, top: 10, bottom: 10 })
          .borderRadius(10)
          .backgroundColor(this.theme.colors.primary)
          .opacity(this.editText.trim().length === 0 ? 0.4 : 1)
          .onClick((): void => this.handleSaveEdit())
      }
      .width('100%')
      .justifyContent(FlexAlign.End)
    }
    .width('100%')
    .padding(16)
  }
}
