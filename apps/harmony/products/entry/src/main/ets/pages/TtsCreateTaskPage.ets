import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import media from '@ohos.multimedia.media';
import { kvStore } from 'features_storage';
import { t, getLang } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { ttsApi, plusApi } from 'features_network';
import type { TtsProvider, TtsVoice, TtsFileItem, TtsReviewItem, TtsBatchCreateFile } from 'features_network';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { AppIcon } from '../components/AppIcon';

// 对齐 mobile app/tts/create.tsx：
// 视图1 select：服务商 chip、音色 chip + 试听、本地文件多选、下一步识别；
// 视图2 review：逐条编辑标题/作者/服务商/音色，可移除，批量创建。

@Entry
@Component
struct TtsCreateTaskPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  @State loading: boolean = false;
  @State view: string = 'select'; // 'select' | 'review'

  @State providers: TtsProvider[] = [];
  @State selectedProvider: string = 'edge';
  @State voices: TtsVoice[] = [];
  @State localFiles: TtsFileItem[] = [];
  @State selectedPaths: string[] = [];
  @State selectedVoice: string = 'zh-CN-XiaoxiaoNeural';
  @State reviewData: TtsReviewItem[] = [];
  @State previewLoading: string = '';

  private previewPlayer: media.AVPlayer | null = null;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.ensureVipAccess().then((ok: boolean) => {
      if (ok) {
        this.fetchProviders();
        this.fetchLocalFiles();
      }
    });
  }

  aboutToDisappear(): void {
    this.releasePreviewPlayer();
  }

  onPageShow(): void {
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  async ensureVipAccess(): Promise<boolean> {
    const plusToken = await kvStore.get('plus_token');
    const plusUserId = await kvStore.get('plus_user_id');
    if (!plusToken || !plusUserId) {
      promptAction.showDialog({
        title: t('common.memberFeature'),
        message: t('common.loginFirst'),
        buttons: [
          { text: t('common.cancel'), color: this.theme.colors.textSecondary },
          { text: t('common.goLogin'), color: this.theme.colors.primary },
        ],
      }).then((res) => {
        if (res.index === 1) router.replaceUrl({ url: 'pages/MemberLoginPage' });
      });
      return false;
    }
    try {
      const profile = await plusApi.getMe(plusUserId);
      const tier = profile?.vipTier ?? '';
      if (!tier || tier === 'NONE') {
        // [软下线] 去开通入口已隐藏，仅保留会员功能提示。恢复时还原 goActivate 按钮与跳 MemberBenefitsPage 的 then 分支。
        promptAction.showDialog({
          title: t('common.memberFeature'),
          message: t('common.ttsVipRequired'),
          buttons: [
            { text: t('common.cancel'), color: this.theme.colors.textSecondary },
          ],
        });
        return false;
      }
      return true;
    } catch (e) {
      Logger.e('TtsCreate', `vip check failed: ${String(e)}`);
      return false;
    }
  }

  async fetchProviders(): Promise<void> {
    try {
      const data = await ttsApi.getProviders();
      if (data.providers && data.providers.length > 0) {
        this.providers = data.providers.slice();
        this.selectedProvider = data.providers[0].id;
        this.fetchVoices(this.selectedProvider);
      }
    } catch (e) {
      Logger.e('TtsCreate', `fetch providers failed: ${String(e)}`);
    }
  }

  async fetchVoices(provider: string): Promise<void> {
    try {
      const data = await ttsApi.getVoices(provider);
      if (data.voices && data.voices.length > 0) {
        this.voices = data.voices.slice();
        this.selectedVoice = data.voices[0].id;
      } else {
        this.voices = [];
      }
    } catch (e) {
      Logger.e('TtsCreate', `fetch voices failed: ${String(e)}`);
    }
  }

  async fetchLocalFiles(): Promise<void> {
    this.loading = true;
    try {
      const res = await ttsApi.getLocalFiles();
      if (res.success) {
        this.localFiles = res.files.slice();
      }
    } catch (e) {
      Logger.e('TtsCreate', `fetch local files failed: ${String(e)}`);
    } finally {
      this.loading = false;
    }
  }

  onProviderSelect(id: string): void {
    if (id === this.selectedProvider) return;
    this.selectedProvider = id;
    this.fetchVoices(id);
  }

  async releasePreviewPlayer(): Promise<void> {
    if (this.previewPlayer) {
      try {
        await this.previewPlayer.release();
      } catch (e) {
        Logger.w('TtsCreate', `release player failed: ${String(e)}`);
      }
      this.previewPlayer = null;
    }
  }

  async handlePreview(voice: string, provider: string): Promise<void> {
    if (this.previewLoading.length > 0) return;
    this.previewLoading = voice;
    try {
      await this.releasePreviewPlayer();
      const url = ttsApi.getPreviewUrl(voice, provider);
      const player = await media.createAVPlayer();
      this.previewPlayer = player;
      player.on('stateChange', (state: media.AVPlayerState): void => {
        if (state === 'initialized') {
          player.prepare();
        } else if (state === 'prepared') {
          player.play();
          this.previewLoading = '';
        } else if (state === 'completed') {
          this.previewLoading = '';
          this.releasePreviewPlayer();
        } else if (state === 'error') {
          this.previewLoading = '';
          this.releasePreviewPlayer();
        }
      });
      player.on('error', (): void => {
        this.previewLoading = '';
        this.releasePreviewPlayer();
      });
      player.url = url;
    } catch (e) {
      Logger.e('TtsCreate', `preview failed: ${String(e)}`);
      promptAction.showDialog({
        title: t('tts.playFailed'),
        message: t('tts.previewLoadFailed'),
        buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
      });
      this.previewLoading = '';
    }
  }

  toggleFileSelection(path: string): void {
    if (this.selectedPaths.includes(path)) {
      this.selectedPaths = this.selectedPaths.filter((p: string): boolean => p !== path);
    } else {
      const next = this.selectedPaths.slice();
      next.push(path);
      this.selectedPaths = next;
    }
  }

  isSelected(path: string): boolean {
    return this.selectedPaths.includes(path);
  }

  voiceName(id: string): string {
    const found = this.voices.find((v: TtsVoice): boolean => v.id === id);
    return found ? found.name : id;
  }

  async handleNextStep(): Promise<void> {
    if (this.selectedPaths.length === 0) {
      promptAction.showToast({ message: t('tts.selectAtLeastOne') });
      return;
    }
    this.loading = true;
    try {
      const res = await ttsApi.identifyBatch(this.selectedPaths);
      if (res.success) {
        const items: TtsReviewItem[] = [];
        for (const r of res.results) {
          const item: TtsReviewItem = {
            key: r.full_path,
            filename: r.filename,
            full_path: r.full_path,
            title: r.title,
            author: r.author,
            voice: this.selectedVoice,
            provider: this.selectedProvider,
          };
          items.push(item);
        }
        this.reviewData = items;
        this.view = 'review';
      }
    } catch (e) {
      Logger.e('TtsCreate', `identify failed: ${String(e)}`);
      promptAction.showDialog({
        title: t('common.error'),
        message: t('tts.identifyFailed'),
        buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
      });
    } finally {
      this.loading = false;
    }
  }

  async handleProcessAll(): Promise<void> {
    this.loading = true;
    try {
      const files: TtsBatchCreateFile[] = [];
      for (const item of this.reviewData) {
        const f: TtsBatchCreateFile = {
          full_path: item.full_path,
          title: item.title,
          author: item.author,
          voice: item.voice,
          provider: item.provider ?? this.selectedProvider,
        };
        if (item.file_id !== undefined) f.file_id = item.file_id;
        if (item.temp_path !== undefined) f.temp_path = item.temp_path;
        files.push(f);
      }
      const res = await ttsApi.createBatchTasks(files);
      if (res.success) {
        promptAction.showToast({ message: t('tts.successCreate', [['count', res.count]]) });
        router.replaceUrl({ url: 'pages/TtsTaskListPage' });
      }
    } catch (e) {
      Logger.e('TtsCreate', `batch create failed: ${String(e)}`);
      promptAction.showDialog({
        title: t('common.error'),
        message: t('tts.createTaskFailed'),
        buttons: [{ text: t('common.ok'), color: this.theme.colors.primary }],
      });
    } finally {
      this.loading = false;
    }
  }

  updateReviewItem(key: string, field: string, value: string): void {
    const next: TtsReviewItem[] = [];
    for (const item of this.reviewData) {
      if (item.key === key) {
        const copy: TtsReviewItem = {
          key: item.key,
          filename: item.filename,
          full_path: item.full_path,
          title: field === 'title' ? value : item.title,
          author: field === 'author' ? value : item.author,
          voice: field === 'voice' ? value : item.voice,
          provider: field === 'provider' ? value : item.provider,
          temp_path: item.temp_path,
          file_id: item.file_id,
        };
        next.push(copy);
      } else {
        next.push(item);
      }
    }
    this.reviewData = next;
  }

  removeReviewItem(key: string): void {
    this.reviewData = this.reviewData.filter((i: TtsReviewItem): boolean => i.key !== key);
  }

  @Builder
  ProviderChips(selectedId: string, onPick: (id: string) => void, small: boolean) {
    List({ space: small ? 8 : 10 }) {
      ForEach(this.providers, (p: TtsProvider) => {
        ListItem() {
          Text(p.name)
            .fontSize(small ? 11 : 14)
            .fontWeight(small ? FontWeight.Regular : FontWeight.Medium)
            .fontColor(selectedId === p.id ? '#FFFFFF' : this.theme.colors.textSecondary)
            .padding({
              left: small ? 10 : 16,
              right: small ? 10 : 16,
              top: small ? 5 : 8,
              bottom: small ? 5 : 8,
            })
            .borderRadius(small ? 14 : 20)
            .border({ width: 1, color: selectedId === p.id ? this.theme.colors.primary : this.theme.colors.border })
            .backgroundColor(selectedId === p.id ? this.theme.colors.primary : Color.Transparent)
            .onClick((): void => onPick(p.id))
        }
      }, (p: TtsProvider): string => p.id)
    }
    .listDirection(Axis.Horizontal)
    .scrollBar(BarState.Off)
    .width('100%')
    .height(small ? 32 : 40)
  }

  @Builder
  VoiceChips(selectedId: string, onPick: (id: string) => void, small: boolean) {
    List({ space: small ? 6 : 8 }) {
      ForEach(this.voices, (v: TtsVoice) => {
        ListItem() {
          Text(`${v.name}${v.gender === 'male' ? ' ♂' : v.gender === 'female' ? ' ♀' : ''}`)
            .fontSize(small ? 11 : 13)
            .fontColor(selectedId === v.id ? '#FFFFFF' : this.theme.colors.textSecondary)
            .padding({
              left: small ? 8 : 12,
              right: small ? 8 : 12,
              top: small ? 4 : 6,
              bottom: small ? 4 : 6,
            })
            .borderRadius(small ? 12 : 16)
            .border({ width: 1, color: selectedId === v.id ? this.theme.colors.primary : this.theme.colors.border })
            .backgroundColor(selectedId === v.id ? this.theme.colors.primary : Color.Transparent)
            .onClick((): void => onPick(v.id))
        }
      }, (v: TtsVoice): string => v.id)
    }
    .listDirection(Axis.Horizontal)
    .scrollBar(BarState.Off)
    .width('100%')
    .height(small ? 28 : 36)
  }

  @Builder
  SelectView() {
    Column() {
      Scroll() {
        Column() {
          // 服务商
          Column() {
            Text(t('tts.providerLabel'))
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.theme.colors.text)
              .margin({ bottom: 12 })
              .alignSelf(ItemAlign.Start)
            this.ProviderChips(this.selectedProvider, (id: string): void => this.onProviderSelect(id), false)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding(16)
          .borderRadius(16)
          .backgroundColor(this.theme.colors.card)
          .margin({ bottom: 20 })

          // 音色
          Column() {
            Text(t('tts.voiceLabel'))
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.theme.colors.text)
              .margin({ bottom: 12 })
              .alignSelf(ItemAlign.Start)

            Row() {
              Row() {
                Text(this.voiceName(this.selectedVoice))
                  .fontSize(14)
                  .fontColor(this.theme.colors.text)
              }
              .layoutWeight(1)
              .height(44)
              .borderRadius(8)
              .border({ width: 1, color: this.theme.colors.border })
              .backgroundColor(this.theme.colors.background)
              .padding({ left: 12, right: 12 })
              .alignItems(VerticalAlign.Center)

              Row() {
                if (this.previewLoading === this.selectedVoice) {
                  LoadingProgress().width(20).height(20).color(this.theme.colors.onPrimary)
                } else {
                  AppIcon({ name: 'volume-high', iconSize: 20, color: this.theme.colors.onPrimary })
                }
              }
              .width(44)
              .height(44)
              .borderRadius(22)
              .justifyContent(FlexAlign.Center)
              .backgroundColor(this.theme.colors.primary)
              .margin({ left: 12 })
              .onClick((): void => {
                this.handlePreview(this.selectedVoice, this.selectedProvider);
              })
            }
            .width('100%')
            .margin({ bottom: 12 })

            this.VoiceChips(this.selectedVoice, (id: string): void => { this.selectedVoice = id; }, false)
          }
          .width('100%')
          .alignItems(HorizontalAlign.Start)
          .padding(16)
          .borderRadius(16)
          .backgroundColor(this.theme.colors.card)
          .margin({ bottom: 20 })

          // 待转换文件
          Row() {
            Text(`${t('tts.pendingFiles')} (${this.localFiles.length})`)
              .fontSize(14)
              .fontWeight(FontWeight.Medium)
              .fontColor(this.theme.colors.textSecondary)
              .layoutWeight(1)
            AppIcon({ name: 'refresh', iconSize: 20, color: this.theme.colors.primary })
              .onClick((): void => {
                this.fetchLocalFiles();
              })
          }
          .width('100%')
          .margin({ bottom: 12 })

          ForEach(this.localFiles, (item: TtsFileItem) => {
            Row() {
              AppIcon({
                name: this.isSelected(item.full_path) ? 'checkbox' : 'square-outline',
                iconSize: 24,
                color: this.isSelected(item.full_path) ? this.theme.colors.primary : this.theme.colors.textSecondary,
              })
              Column() {
                Text(item.filename)
                  .fontSize(15)
                  .fontWeight(FontWeight.Medium)
                  .fontColor(this.theme.colors.text)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(item.full_path)
                  .fontSize(11)
                  .fontColor(this.theme.colors.textSecondary)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .margin({ top: 2 })
              }
              .layoutWeight(1)
              .alignItems(HorizontalAlign.Start)
              .margin({ left: 12 })

              if (item.is_generated) {
                Text(t('tts.generated'))
                  .fontSize(10)
                  .fontColor(this.theme.colors.textSecondary)
                  .backgroundColor(this.theme.colors.border)
                  .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                  .borderRadius(4)
                  .margin({ left: 8 })
              }
            }
            .width('100%')
            .padding({ top: 12, bottom: 12 })
            .border({ width: { bottom: 1 }, color: this.theme.colors.border })
            .opacity(item.is_generated ? 0.5 : 1)
            .onClick((): void => {
              if (!item.is_generated) this.toggleFileSelection(item.full_path);
            })
          }, (item: TtsFileItem): string => item.full_path)

          Row().height(120)
        }
        .width('100%')
        .padding(16)
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      // bottom bar
      Row() {
        Text(t('tts.selectedFiles', [['count', this.selectedPaths.length]]))
          .fontSize(14)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)

        Row() {
          if (this.loading) {
            LoadingProgress().width(24).height(24).color('#FFFFFF')
          } else {
            Text(t('tts.nextStep'))
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
            AppIcon({ name: 'arrow-forward', iconSize: 20, color: '#FFFFFF' })
              .margin({ left: 8 })
          }
        }
        .height(48)
        .padding({ left: 24, right: 24 })
        .borderRadius(24)
        .backgroundColor(this.theme.colors.primary)
        .opacity(this.selectedPaths.length === 0 || this.loading ? 0.5 : 1)
        .onClick((): void => {
          if (this.selectedPaths.length === 0 || this.loading) return;
          this.handleNextStep();
        })
      }
      .width('100%')
      .padding(16)
      .alignItems(VerticalAlign.Center)
      .backgroundColor(this.theme.colors.card)
      .border({ width: { top: 1 }, color: this.theme.colors.border })
    }
    .width('100%')
    .layoutWeight(1)
  }

  @Builder
  ReviewCard(item: TtsReviewItem) {
    Column() {
      // 标题
      Column() {
        Text(t('tts.titleLabel'))
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
          .margin({ bottom: 6 })
        TextInput({ text: item.title })
          .height(40)
          .fontSize(14)
          .fontColor(this.theme.colors.text)
          .backgroundColor(Color.Transparent)
          .border({ width: 1, color: this.theme.colors.border })
          .borderRadius(8)
          .padding({ left: 12, right: 12 })
          .onChange((val: string): void => this.updateReviewItem(item.key, 'title', val))
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .margin({ bottom: 12 })

      // 作者
      Column() {
        Text(t('tts.authorLabel'))
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
          .margin({ bottom: 6 })
        TextInput({ text: item.author })
          .height(40)
          .fontSize(14)
          .fontColor(this.theme.colors.text)
          .backgroundColor(Color.Transparent)
          .border({ width: 1, color: this.theme.colors.border })
          .borderRadius(8)
          .padding({ left: 12, right: 12 })
          .onChange((val: string): void => this.updateReviewItem(item.key, 'author', val))
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .margin({ bottom: 12 })

      // 服务商
      Column() {
        Text(t('tts.provider'))
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
          .margin({ bottom: 6 })
        this.ProviderChips(item.provider ?? this.selectedProvider, (id: string): void => this.updateReviewItem(item.key, 'provider', id), true)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .margin({ bottom: 12 })

      // 音色
      Column() {
        Text(t('tts.voice'))
          .fontSize(13)
          .fontColor(this.theme.colors.textSecondary)
          .margin({ bottom: 6 })
        Row() {
          Row() {
            Text(this.voiceName(item.voice))
              .fontSize(14)
              .fontColor(this.theme.colors.text)
          }
          .layoutWeight(1)
          .height(36)
          .borderRadius(8)
          .border({ width: 1, color: this.theme.colors.border })
          .padding({ left: 12, right: 12 })
          .alignItems(VerticalAlign.Center)

          Row() {
            if (this.previewLoading === item.voice) {
              LoadingProgress().width(18).height(18).color(this.theme.colors.primary)
            } else {
              AppIcon({ name: 'volume-high', iconSize: 18, color: this.theme.colors.primary })
            }
          }
          .width(36)
          .height(36)
          .borderRadius(18)
          .justifyContent(FlexAlign.Center)
          .backgroundColor(this.theme.colors.primary + '20')
          .margin({ left: 8 })
          .onClick((): void => {
            this.handlePreview(item.voice, item.provider ?? this.selectedProvider);
          })
        }
        .width('100%')
        .margin({ bottom: 8 })

        this.VoiceChips(item.voice, (id: string): void => this.updateReviewItem(item.key, 'voice', id), true)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)

      Text(t('tts.removeTask'))
        .fontSize(13)
        .fontColor('#ff4d4f')
        .alignSelf(ItemAlign.End)
        .margin({ top: 12 })
        .onClick((): void => this.removeReviewItem(item.key))
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
    .padding(16)
    .borderRadius(16)
    .border({ width: 1, color: this.theme.colors.border })
    .backgroundColor(this.theme.colors.card)
    .margin({ bottom: 16 })
  }

  @Builder
  ReviewView() {
    Column() {
      Scroll() {
        Column() {
          Text(t('tts.confirmTaskDetail'))
            .fontSize(20)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.theme.colors.text)
            .margin({ bottom: 20 })
            .alignSelf(ItemAlign.Start)

          ForEach(this.reviewData, (item: TtsReviewItem) => {
            this.ReviewCard(item)
          }, (item: TtsReviewItem): string => item.key)

          Row().height(120)
        }
        .width('100%')
        .padding(16)
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)

      // bottom bar
      Row() {
        Row() {
          Text(t('tts.backToEdit'))
            .fontSize(16)
            .fontColor(this.theme.colors.text)
        }
        .height(48)
        .padding({ left: 20, right: 20 })
        .borderRadius(24)
        .border({ width: 1, color: this.theme.colors.border })
        .margin({ right: 12 })
        .onClick((): void => {
          this.view = 'select';
        })

        Row() {
          if (this.loading) {
            LoadingProgress().width(24).height(24).color('#FFFFFF')
          } else {
            Text(t('tts.startTasks', [['count', this.reviewData.length]]))
              .fontSize(16)
              .fontWeight(FontWeight.Bold)
              .fontColor('#FFFFFF')
          }
        }
        .layoutWeight(1)
        .height(48)
        .borderRadius(24)
        .justifyContent(FlexAlign.Center)
        .backgroundColor(this.theme.colors.primary)
        .opacity(this.reviewData.length === 0 || this.loading ? 0.5 : 1)
        .onClick((): void => {
          if (this.reviewData.length === 0 || this.loading) return;
          this.handleProcessAll();
        })
      }
      .width('100%')
      .padding(16)
      .alignItems(VerticalAlign.Center)
      .backgroundColor(this.theme.colors.card)
      .border({ width: { top: 1 }, color: this.theme.colors.border })
    }
    .width('100%')
    .layoutWeight(1)
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
        .onClick((): void => {
          if (this.view === 'review') {
            this.view = 'select';
          } else {
            router.back();
          }
        })

        Text(t('tts.createTaskTitle'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Row().width(40).height(40)
      }
      .width('100%')
      .padding({ left: 15, right: 15, top: 16, bottom: 8 })

      if (this.view === 'select') {
        this.SelectView()
      } else {
        this.ReviewView()
      }
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
