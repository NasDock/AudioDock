import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { t, getLang } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { ttsConfigApi } from 'features_network';
import type { TtsProviderOption, TtsProviderConfig } from 'features_network';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { AppIcon } from '../components/AppIcon';

// 对齐 mobile app/tts-config.tsx：服务商选择 + 字段表单 + 保存/测试/删除。

class FieldDef {
  field: string = '';
  labelKey: string = '';
  configKey: string = '';

  constructor(field: string, labelKey: string, configKey: string) {
    this.field = field;
    this.labelKey = labelKey;
    this.configKey = configKey;
  }
}

const FIELD_DEFS: FieldDef[] = [
  new FieldDef('apiKey', 'settings.ttsConfigFieldApiKey', 'api_key'),
  new FieldDef('appId', 'settings.ttsConfigFieldAppId', 'app_id'),
  new FieldDef('groupId', 'settings.ttsConfigFieldGroupId', 'group_id'),
  new FieldDef('model', 'settings.ttsConfigFieldModel', 'model'),
];

class DialogButton {
  text: string = '';
  color: string = '';

  constructor(text: string, color: string) {
    this.text = text;
    this.color = color;
  }
}

@Entry
@Component
struct TtsConfigPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  @State providers: TtsProviderOption[] = [];
  @State selected: string = '';
  @State configs: Record<string, TtsProviderConfig> = {};
  // 对齐 mobile 的 draft Record，用显式字段替代索引访问
  @State draftApiKey: string = '';
  @State draftAppId: string = '';
  @State draftGroupId: string = '';
  @State draftModel: string = '';
  @State loading: boolean = true;
  @State saving: boolean = false;
  @State testing: boolean = false;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.loadAll();
  }

  onPageShow(): void {
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  fieldsFor(provider: string): string[] {
    if (provider === 'mimo') return ['apiKey', 'model'];
    if (provider === 'minimax') return ['apiKey', 'groupId', 'model'];
    if (provider === 'volc') return ['appId', 'apiKey'];
    return ['apiKey'];
  }

  defaultFor(provider: string, field: string): string {
    if (field === 'model') {
      if (provider === 'mimo') return 'mimo-v2.5-tts';
      if (provider === 'minimax') return 'speech-2.8-hd';
    }
    return '';
  }

  storedValue(cfg: TtsProviderConfig | undefined, configKey: string): string {
    if (!cfg) return '';
    if (configKey === 'api_key') return cfg.api_key ?? '';
    if (configKey === 'app_id') return cfg.app_id ?? '';
    if (configKey === 'group_id') return cfg.group_id ?? '';
    if (configKey === 'model') return cfg.model ?? '';
    return '';
  }

  async loadAll(): Promise<void> {
    try {
      const provRes = await ttsConfigApi.getSupportedProviders();
      const confRes = await ttsConfigApi.getProviderConfigs();
      const list = provRes.providers ?? [];
      this.providers = list.slice();
      const cfgs = confRes.configs ?? {};
      const copied: Record<string, TtsProviderConfig> = {};
      const keys = Object.keys(cfgs);
      for (const k of keys) copied[k] = cfgs[k];
      this.configs = copied;

      let initial: TtsProviderOption | undefined = list.find((p: TtsProviderOption): boolean => p.id === 'mimo');
      if (!initial) initial = list.find((p: TtsProviderOption): boolean => this.fieldsFor(p.id).length > 0);
      if (!initial && list.length > 0) initial = list[0];
      if (initial) {
        this.selected = initial.id;
        this.rebuildDraft(initial.id);
      }
    } catch (e) {
      Logger.w('TtsConfig', `load failed: ${String(e)}`);
    } finally {
      this.loading = false;
    }
  }

  rebuildDraft(provider: string): void {
    const stored = this.configs[provider];
    this.draftApiKey = this.pickValue(stored, provider, 'apiKey', 'api_key');
    this.draftAppId = this.pickValue(stored, provider, 'appId', 'app_id');
    this.draftGroupId = this.pickValue(stored, provider, 'groupId', 'group_id');
    this.draftModel = this.pickValue(stored, provider, 'model', 'model');
  }

  pickValue(stored: TtsProviderConfig | undefined, provider: string, field: string, configKey: string): string {
    const v = this.storedValue(stored, configKey);
    if (v.length > 0) return v;
    return this.defaultFor(provider, field);
  }

  onProviderSelect(id: string): void {
    this.selected = id;
    this.rebuildDraft(id);
  }

  draftFor(field: string): string {
    if (field === 'apiKey') return this.draftApiKey;
    if (field === 'appId') return this.draftAppId;
    if (field === 'groupId') return this.draftGroupId;
    if (field === 'model') return this.draftModel;
    return '';
  }

  setDraft(field: string, v: string): void {
    if (field === 'apiKey') this.draftApiKey = v;
    else if (field === 'appId') this.draftAppId = v;
    else if (field === 'groupId') this.draftGroupId = v;
    else if (field === 'model') this.draftModel = v;
  }

  buildPayload(): TtsProviderConfig {
    const payload: TtsProviderConfig = {};
    const fields = this.fieldsFor(this.selected);
    for (const field of fields) {
      const fd = FIELD_DEFS.find((d: FieldDef): boolean => d.field === field);
      if (!fd) continue;
      const v = this.draftFor(field).trim();
      if (v.length === 0) continue;
      if (fd.configKey === 'api_key') payload.api_key = v;
      else if (fd.configKey === 'app_id') payload.app_id = v;
      else if (fd.configKey === 'group_id') payload.group_id = v;
      else if (fd.configKey === 'model') payload.model = v;
    }
    return payload;
  }

  async handleSave(): Promise<void> {
    if (this.selected.length === 0) return;
    this.saving = true;
    try {
      const payload = this.buildPayload();
      const res = await ttsConfigApi.saveProviderConfig(this.selected, payload);
      const next: Record<string, TtsProviderConfig> = {};
      const keys = Object.keys(this.configs);
      for (const k of keys) next[k] = this.configs[k];
      next[this.selected] = res.config ?? {};
      this.configs = next;
      promptAction.showToast({ message: t('settings.ttsConfigSaveSuccess') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      promptAction.showDialog({
        title: t('settings.ttsConfigSaveFailed'),
        message: msg,
        buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
      });
    } finally {
      this.saving = false;
    }
  }

  async handleTest(): Promise<void> {
    if (this.selected.length === 0) return;
    this.testing = true;
    try {
      const payload = this.buildPayload();
      await ttsConfigApi.testProviderConfig(this.selected, payload);
      promptAction.showToast({ message: t('settings.testConnectionSuccess') });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      promptAction.showDialog({
        title: t('settings.testConnectionFailed'),
        message: msg,
        buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
      });
    } finally {
      this.testing = false;
    }
  }

  handleDelete(): void {
    if (this.selected.length === 0) return;
    promptAction.showDialog({
      title: t('settings.ttsConfig'),
      message: t('common.deleteConfirm'),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
        { text: t('common.delete'), color: '#FF3B30' },
      ],
    }).then(async (res) => {
      if (res.index === 1) {
        try {
          await ttsConfigApi.deleteProviderConfig(this.selected);
          const next: Record<string, TtsProviderConfig> = {};
          const keys = Object.keys(this.configs);
          for (const k of keys) {
            if (k !== this.selected) next[k] = this.configs[k];
          }
          this.configs = next;
          this.rebuildDraft(this.selected);
          promptAction.showToast({ message: t('settings.ttsConfigDeleteSuccess') });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          promptAction.showDialog({
            title: t('settings.ttsConfigSaveFailed'),
            message: msg,
            buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
          });
        }
      }
    });
  }

  pickProvider(): void {
    if (this.providers.length === 0) return;
    const buttons: DialogButton[] = [];
    for (const p of this.providers) {
      buttons.push(new DialogButton(p.name, this.theme.colors.text));
    }
    promptAction.showDialog({
      title: t('settings.ttsConfig'),
      buttons: buttons,
    }).then((res) => {
      const idx = res.index;
      if (idx >= 0 && idx < this.providers.length) {
        this.onProviderSelect(this.providers[idx].id);
      }
    });
  }

  selectedLabel(): string {
    const found = this.providers.find((p: TtsProviderOption): boolean => p.id === this.selected);
    return found ? found.name : '-';
  }

  isConfigured(): boolean {
    return this.selected.length > 0 && this.configs[this.selected] !== undefined;
  }

  fieldsForSelected(): FieldDef[] {
    if (this.selected.length === 0) return [];
    const fields = this.fieldsFor(this.selected);
    const out: FieldDef[] = [];
    for (const field of fields) {
      const fd = FIELD_DEFS.find((d: FieldDef): boolean => d.field === field);
      if (fd) out.push(fd);
    }
    return out;
  }

  @Builder
  FieldRow(fd: FieldDef) {
    Column() {
      Text(t(fd.labelKey))
        .fontSize(14)
        .fontWeight(FontWeight.Medium)
        .fontColor(this.theme.colors.text)
        .margin({ bottom: 6 })
      TextInput({
        text: this.draftFor(fd.field),
        placeholder: fd.field === 'apiKey' ? t('settings.llmConfigKeyHint') : '',
      })
        .placeholderColor(this.theme.colors.textSecondary)
        .fontColor(this.theme.colors.text)
        .fontSize(15)
        .height(44)
        .borderRadius(10)
        .border({ width: 0.5, color: this.theme.colors.border })
        .backgroundColor(this.theme.colors.card)
        .padding({ left: 14, right: 14 })
        .type(fd.field === 'apiKey' ? InputType.Password : InputType.Normal)
        .onChange((v: string): void => {
          this.setDraft(fd.field, v);
        })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .margin({ bottom: 16 })
  }

  @Builder
  LocalizedContent() {
    Column() {
      // Header
      Row() {
        Button() {
          AppIcon({ name: 'chevron-back', iconSize: 24, color: this.theme.colors.text })
        }
        .width(40)
        .height(40)
        .backgroundColor(Color.Transparent)
        .onClick((): void => router.back())

        Text(t('settings.ttsConfig'))
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
        Column() {
          Text(t('settings.ttsConfigDescription'))
            .fontSize(14)
            .lineHeight(20)
            .fontColor(this.theme.colors.textSecondary)
            .margin({ top: 8 })
            .width('100%')

          if (this.loading) {
            LoadingProgress().width(36).height(36).color(this.theme.colors.primary)
              .margin({ top: 24 })
          } else if (this.providers.length === 0) {
            Text(t('settings.ttsConfigEmpty'))
              .fontSize(14)
              .fontColor(this.theme.colors.textSecondary)
              .margin({ top: 24 })
              .width('100%')
          } else {
            Column() {
              // 服务商选择
              Column() {
                Text(t('settings.ttsConfig'))
                  .fontSize(14)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.theme.colors.text)
                  .margin({ bottom: 6 })
                Row() {
                  Text(this.selectedLabel() + (this.isConfigured() ? ' ✓' : ''))
                    .fontSize(15)
                    .fontColor(this.theme.colors.text)
                    .layoutWeight(1)
                  Text('›')
                    .fontSize(18)
                    .fontColor(this.theme.colors.textSecondary)
                }
                .width('100%')
                .height(44)
                .borderRadius(10)
                .border({ width: 0.5, color: this.theme.colors.border })
                .backgroundColor(this.theme.colors.card)
                .padding({ left: 14, right: 14 })
                .alignItems(VerticalAlign.Center)
                .onClick((): void => this.pickProvider())
              }
              .width('100%')
              .alignItems(HorizontalAlign.Start)
              .margin({ bottom: 16 })

              ForEach(this.fieldsForSelected(), (fd: FieldDef) => {
                this.FieldRow(fd)
              }, (fd: FieldDef): string => fd.field)

              Row({ space: 12 }) {
                Button() {
                  if (this.saving) {
                    LoadingProgress().width(22).height(22).color('#FFFFFF')
                  } else {
                    Text(t('common.save'))
                      .fontSize(16)
                      .fontWeight(FontWeight.Medium)
                      .fontColor('#FFFFFF')
                  }
                }
                .layoutWeight(1)
                .height(48)
                .borderRadius(12)
                .backgroundColor(this.theme.colors.primary)
                .enabled(!this.saving && !this.testing)
                .onClick((): void => {
                  this.handleSave();
                })

                Button() {
                  if (this.testing) {
                    LoadingProgress().width(22).height(22).color(this.theme.colors.text)
                  } else {
                    Text(t('settings.testConnection'))
                      .fontSize(15)
                      .fontWeight(FontWeight.Medium)
                      .fontColor(this.theme.colors.text)
                  }
                }
                .height(48)
                .padding({ left: 18, right: 18 })
                .borderRadius(12)
                .backgroundColor(Color.Transparent)
                .border({ width: 0.5, color: this.theme.colors.border })
                .enabled(!this.saving && !this.testing)
                .onClick((): void => {
                  this.handleTest();
                })

                if (this.isConfigured()) {
                  Button(t('common.delete'))
                    .height(48)
                    .padding({ left: 18, right: 18 })
                    .borderRadius(12)
                    .backgroundColor(Color.Transparent)
                    .border({ width: 0.5, color: this.theme.colors.border })
                    .fontColor(this.theme.colors.text)
                    .fontSize(15)
                    .onClick((): void => this.handleDelete())
                }
              }
              .width('100%')
              .margin({ top: 24 })
            }
            .width('100%')
            .margin({ top: 12 })
          }
        }
        .width('100%')
        .padding({ left: 20, right: 20, bottom: 40 })
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }

  build() {
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
}
