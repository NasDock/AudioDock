import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { kvStore } from 'features_storage';
import { t, getLang } from 'features_i18n';
import { Logger } from 'audiodock_common';
import { ttsApi, plusApi } from 'features_network';
import type { TtsTask } from 'features_network';
import { buildTheme } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { AppIcon } from '../components/AppIcon';

// 对齐 mobile app/tts/tasks.tsx：任务列表 + 状态筛选 + 5s 轮询 + 暂停/恢复/删除。
class FilterOption {
  labelKey: string = '';
  value: string = '';

  constructor(labelKey: string, value: string) {
    this.labelKey = labelKey;
    this.value = value;
  }
}

const FILTERS: FilterOption[] = [
  new FilterOption('tts.all', 'all'),
  new FilterOption('tts.pending', 'pending'),
  new FilterOption('tts.processing', 'processing'),
  new FilterOption('tts.completed', 'completed'),
  new FilterOption('tts.paused', 'paused'),
  new FilterOption('tts.failed', 'failed'),
];

@Entry
@Component
struct TtsTaskListPage {
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  @State tasks: TtsTask[] = [];
  @State loading: boolean = true;
  @State refreshing: boolean = false;
  @State filterStatus: string = 'all';

  private pollTimer: number = -1;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.ensureVipAccess().then((ok: boolean) => {
      if (ok) {
        this.fetchTasks(true);
        this.pollTimer = setInterval((): void => {
          this.fetchTasks(false);
        }, 5000);
      } else {
        this.loading = false;
      }
    });
  }

  aboutToDisappear(): void {
    if (this.pollTimer !== -1) {
      clearInterval(this.pollTimer);
      this.pollTimer = -1;
    }
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
        if (res.index === 1) {
          router.replaceUrl({ url: 'pages/MemberLoginPage' });
        }
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
      Logger.e('TtsTaskList', `vip check failed: ${String(e)}`);
      return false;
    }
  }

  async fetchTasks(showLoading: boolean): Promise<void> {
    if (showLoading) this.loading = true;
    try {
      const res = await ttsApi.getTasks();
      const list = res.tasks ?? [];
      this.tasks = list.slice();
    } catch (e) {
      Logger.e('TtsTaskList', `fetch tasks failed: ${String(e)}`);
    } finally {
      if (showLoading) this.loading = false;
      this.refreshing = false;
    }
  }

  onRefresh(): void {
    this.refreshing = true;
    this.fetchTasks(false);
  }

  filteredTasks(): TtsTask[] {
    if (this.filterStatus === 'all') return this.tasks;
    return this.tasks.filter((task: TtsTask): boolean => task.status === this.filterStatus);
  }

  statusColor(status: string): string {
    switch (status) {
      case 'completed': return '#52c41a';
      case 'failed': return '#ff4d4f';
      case 'processing': return '#faad14';
      case 'paused': return '#8c8c8c';
      case 'pending': return '#13c2c2';
      default: return this.theme.colors.primary;
    }
  }

  statusText(status: string): string {
    switch (status) {
      case 'completed': return t('tts.completed');
      case 'failed': return t('tts.failed');
      case 'processing': return t('tts.processing');
      case 'paused': return t('tts.paused');
      case 'pending': return t('tts.pending');
      default: return status.toUpperCase();
    }
  }

  handleAction(action: string, id: string): void {
    if (action === 'delete') {
      promptAction.showDialog({
        title: t('tts.deleteTask'),
        message: t('tts.confirmDeleteTask'),
        buttons: [
          { text: t('common.cancel'), color: this.theme.colors.textSecondary },
          { text: t('common.delete'), color: '#ff4d4f' },
        ],
      }).then(async (res) => {
        if (res.index === 1) {
          try {
            await ttsApi.deleteTask(id);
            this.fetchTasks(false);
          } catch (e) {
            Logger.e('TtsTaskList', `delete failed: ${String(e)}`);
            promptAction.showToast({ message: t('tts.actionFailed') });
          }
        }
      });
      return;
    }
    const run = async (): Promise<void> => {
      try {
        if (action === 'pause') {
          await ttsApi.pauseTask(id);
        } else if (action === 'resume') {
          await ttsApi.resumeTask(id);
        }
        this.fetchTasks(false);
      } catch (e) {
        Logger.e('TtsTaskList', `${action} failed: ${String(e)}`);
        promptAction.showToast({ message: t('tts.actionFailed') });
      }
    };
    run();
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  @Builder
  TaskCard(item: TtsTask) {
    Column() {
      Row() {
        Column() {
          Text(item.book_name)
            .fontSize(18)
            .fontWeight(FontWeight.Bold)
            .fontColor(this.theme.colors.text)
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
          Text(item.author)
            .fontSize(14)
            .fontColor(this.theme.colors.textSecondary)
            .margin({ top: 4 })
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        Text(this.statusText(item.status))
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(this.statusColor(item.status))
          .backgroundColor(this.statusColor(item.status) + '20')
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .borderRadius(8)
      }
      .width('100%')
      .margin({ bottom: 16 })

      // progress
      Column() {
        Stack({ alignContent: Alignment.Start }) {
          Row()
            .width('100%')
            .height(6)
            .borderRadius(3)
            .backgroundColor(this.theme.colors.border)
          Row()
            .width(`${item.total_chapters > 0 ? Math.round((item.completed_chapters / item.total_chapters) * 100) : 0}%`)
            .height(6)
            .borderRadius(3)
            .backgroundColor(this.statusColor(item.status))
        }
        .width('100%')

        Row() {
          Text(`${item.completed_chapters} / ${item.total_chapters} ${t('tts.chapters')}`)
            .fontSize(12)
            .fontColor(this.theme.colors.textSecondary)
          Text(`${item.total_chapters > 0 ? Math.round((item.completed_chapters / item.total_chapters) * 100) : 0}%`)
            .fontSize(12)
            .fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.text)
        }
        .width('100%')
        .justifyContent(FlexAlign.SpaceBetween)
        .margin({ top: 8 })
      }
      .width('100%')
      .margin({ bottom: 16 })

      Row()
        .width('100%')
        .height(1)
        .backgroundColor(this.theme.colors.border)
        .margin({ bottom: 12 })

      Row() {
        Text(this.formatTime(item.created_at))
          .fontSize(12)
          .fontColor(this.theme.colors.textSecondary)
          .layoutWeight(1)

        Row({ space: 12 }) {
          if (item.status === 'processing') {
            Row() {
              AppIcon({ name: 'pause', iconSize: 20, color: this.theme.colors.primary })
            }
            .padding(6)
            .onClick((): void => this.handleAction('pause', item.id))
          }
          if (item.status === 'paused' || item.status === 'failed' || item.status === 'pending') {
            Row() {
              AppIcon({
                name: item.status === 'failed' ? 'refresh' : 'play',
                iconSize: 20,
                color: this.theme.colors.primary,
              })
            }
            .padding(6)
            .onClick((): void => this.handleAction('resume', item.id))
          }
          Row() {
            AppIcon({ name: 'trash', iconSize: 20, color: '#ff4d4f' })
          }
          .padding(6)
          .onClick((): void => this.handleAction('delete', item.id))
        }
      }
      .width('100%')
    }
    .width('100%')
    .padding(16)
    .borderRadius(16)
    .backgroundColor(this.theme.colors.card)
    .border({ width: 1, color: this.theme.colors.border })
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

        Text(t('tts.taskListTitle'))
          .fontSize(20)
          .fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .layoutWeight(1)
          .textAlign(TextAlign.Center)

        Button() {
          AppIcon({ name: 'plus', iconSize: 24, color: this.theme.colors.primary })
        }
        .width(40)
        .height(40)
        .backgroundColor(Color.Transparent)
        .onClick((): void => {
          router.pushUrl({ url: 'pages/TtsCreateTaskPage' });
        })
      }
      .width('100%')
      .padding({ left: 15, right: 15, top: 16, bottom: 8 })

      // Filters
      List({ space: 8 }) {
        ForEach(FILTERS, (f: FilterOption) => {
          ListItem() {
            Text(t(f.labelKey))
              .fontSize(14)
              .fontColor(this.filterStatus === f.value ? this.theme.colors.onPrimary : this.theme.colors.textSecondary)
              .padding({ left: 16, right: 16, top: 6, bottom: 6 })
              .borderRadius(20)
              .backgroundColor(this.filterStatus === f.value ? this.theme.colors.primary : Color.Transparent)
              .onClick((): void => {
                this.filterStatus = f.value;
              })
          }
        }, (f: FilterOption): string => f.value)
      }
      .listDirection(Axis.Horizontal)
      .scrollBar(BarState.Off)
      .width('100%')
      .height(44)
      .padding({ left: 16, right: 16 })
      .margin({ bottom: 4 })

      if (this.loading && !this.refreshing) {
        Column() {
          LoadingProgress().width(40).height(40).color(this.theme.colors.primary)
        }
        .width('100%')
        .layoutWeight(1)
        .justifyContent(FlexAlign.Center)
      } else {
        Refresh({ refreshing: this.refreshing }) {
          List() {
            if (this.filteredTasks().length === 0) {
              ListItem() {
                Column() {
                  AppIcon({ name: 'document', iconSize: 64, color: this.theme.colors.border })
                  Text(t('tts.noTasksYet'))
                    .fontSize(16)
                    .fontColor(this.theme.colors.textSecondary)
                    .margin({ top: 16, bottom: 24 })
                  Button(t('tts.createNow'))
                    .height(44)
                    .padding({ left: 24, right: 24 })
                    .borderRadius(22)
                    .backgroundColor(this.theme.colors.primary)
                    .fontColor(this.theme.colors.onPrimary)
                    .fontSize(16)
                    .fontWeight(FontWeight.Bold)
                    .onClick((): void => {
                      router.pushUrl({ url: 'pages/TtsCreateTaskPage' });
                    })
                }
                .width('100%')
                .alignItems(HorizontalAlign.Center)
                .margin({ top: 100 })
              }
            } else {
              ForEach(this.filteredTasks(), (item: TtsTask) => {
                ListItem() {
                  this.TaskCard(item)
                }
              }, (item: TtsTask): string => item.id)
            }
          }
          .width('100%')
          .padding({ left: 16, right: 16, bottom: 40 })
          .scrollBar(BarState.Off)
        }
        .width('100%')
        .layoutWeight(1)
        .onRefreshing((): void => this.onRefresh())
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
