import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { pasteboard } from '@kit.BasicServicesKit';
import { accessTokenApi } from 'features_network';
import type { AccessToken, UpdateAccessTokenDto } from 'features_network';
import { buildTheme, CommonNavBar } from 'features_ui';
import type { Theme, ThemeMode } from 'features_ui';
import { t } from 'features_i18n';
import { Logger } from 'audiodock_common';

/**
 * API 访问令牌管理页，对齐 desktop Admin/AccessTokenManagement：
 * 列表（名称/前缀/启停开关/最近使用/创建时间）+ 创建（名称弹窗，
 * 完整令牌仅此一次展示并可复制）+ 重命名 + 删除确认。
 * 注意：完整令牌明文只有创建接口返回一次，之后只能看前缀。
 */

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

const formatTime = (value?: string | null): string => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

@Entry
@Component
struct AccessTokenPage {
  @State tokens: AccessToken[] = [];
  @State loading: boolean = true;
  // 名称输入弹窗：'none' | 'create' | 'rename'
  @State dialogMode: string = 'none';
  @State nameInput: string = '';
  @State renameTargetId: number = 0;
  @State submitting: boolean = false;
  // 创建成功后展示的完整令牌（空串 = 不展示），仅此一次可见
  @State createdToken: string = '';
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State theme: Theme = buildTheme('light');
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    this.loadTokens();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  private async loadTokens(): Promise<void> {
    this.loading = true;
    try {
      this.tokens = await accessTokenApi.list();
    } catch (e) {
      Logger.w('AccessTokenPage', `load tokens failed: ${String(e)}`);
      promptAction.showToast({ message: t('accessToken.fetchFailed') });
    } finally {
      this.loading = false;
    }
  }

  private openCreate(): void {
    this.nameInput = '';
    this.renameTargetId = 0;
    this.dialogMode = 'create';
  }

  private openRename(token: AccessToken): void {
    this.nameInput = token.name;
    this.renameTargetId = token.id;
    this.dialogMode = 'rename';
  }

  private closeDialog(): void {
    this.dialogMode = 'none';
    this.nameInput = '';
    this.renameTargetId = 0;
    this.submitting = false;
  }

  private async submitName(): Promise<void> {
    const name = this.nameInput.trim();
    if (name.length === 0) {
      promptAction.showToast({ message: t('accessToken.nameRequired') });
      return;
    }
    if (this.submitting) return;
    this.submitting = true;
    try {
      if (this.dialogMode === 'create') {
        const created = await accessTokenApi.create(name);
        this.closeDialog();
        this.createdToken = created.token;
      } else {
        const dto: UpdateAccessTokenDto = { name };
        await accessTokenApi.update(this.renameTargetId, dto);
        this.closeDialog();
      }
      this.loadTokens();
    } catch (e) {
      Logger.w('AccessTokenPage', `submit name failed: ${String(e)}`);
      this.submitting = false;
    }
  }

  private async copyCreatedToken(): Promise<void> {
    if (this.createdToken.length === 0) return;
    try {
      const data = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.createdToken);
      await pasteboard.getSystemPasteboard().setData(data);
      promptAction.showToast({ message: t('accessToken.copySuccess') });
    } catch (e) {
      Logger.w('AccessTokenPage', `copy token failed: ${String(e)}`);
      promptAction.showToast({ message: t('accessToken.copyFailed') });
    }
  }

  private async toggleEnabled(token: AccessToken, enabled: boolean): Promise<void> {
    try {
      const dto: UpdateAccessTokenDto = { enabled };
      await accessTokenApi.update(token.id, dto);
    } catch (e) {
      Logger.w('AccessTokenPage', `toggle token failed: ${String(e)}`);
    } finally {
      // 成功失败都重拉：失败时把开关回弹到真实状态
      this.loadTokens();
    }
  }

  private confirmDelete(token: AccessToken): void {
    promptAction.showDialog({
      title: t('accessToken.deleteConfirmTitle'),
      message: t('accessToken.deleteConfirmContent', [['name', token.name]]),
      buttons: [
        { text: t('common.cancel'), color: this.theme.colors.textSecondary },
        { text: t('common.delete'), color: '#FF3B30' },
      ],
    }).then(async (res) => {
      if (res.index === 1) {
        try {
          await accessTokenApi.remove(token.id);
          promptAction.showToast({ message: t('accessToken.deleteSuccess') });
        } catch (e) {
          Logger.w('AccessTokenPage', `delete token failed: ${String(e)}`);
        } finally {
          this.loadTokens();
        }
      }
    }).catch(() => undefined);
  }

  build() {
    Stack() {
      Column() {
        CommonNavBar({ title: t('accessToken.title'), theme: this.theme, onBack: () => router.back() })

        if (this.loading && this.tokens.length === 0) {
          Column() {
            LoadingProgress().width(32).height(32).color(this.theme.colors.primary)
          }
          .width('100%').layoutWeight(1).justifyContent(FlexAlign.Center)
        } else {
          Scroll() {
            Column({ space: 15 }) {
              Text(t('accessToken.description'))
                .fontSize(13).fontColor(this.theme.colors.textSecondary)

              if (this.tokens.length === 0) {
                Text(t('accessToken.empty'))
                  .fontSize(14).fontColor(this.theme.colors.textSecondary)
                  .width('100%').textAlign(TextAlign.Center)
                  .padding(24)
                  .borderRadius(12)
                  .border({ width: 1, color: this.theme.colors.border, style: BorderStyle.Dashed })
              } else {
                ForEach(this.tokens, (token: AccessToken) => {
                  this.TokenCard(token)
                }, (token: AccessToken) => `${token.id}_${token.enabled}`)
              }

              // 创建令牌
              Row({ space: 8 }) {
                Text('+').fontSize(18).fontColor(this.theme.colors.primary)
                Text(t('accessToken.create')).fontSize(15).fontColor(this.theme.colors.primary)
              }
              .width('100%')
              .padding(16)
              .borderRadius(12)
              .border({ width: 1, color: this.theme.colors.primary, style: BorderStyle.Dashed })
              .backgroundColor(this.theme.colors.surface)
              .justifyContent(FlexAlign.Center)
              .onClick(() => this.openCreate())
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

      // 名称输入弹窗（创建 / 重命名）
      if (this.dialogMode !== 'none') {
        this.NameDialog()
      }

      // 创建成功弹窗（完整令牌仅此一次展示）
      if (this.createdToken.length > 0) {
        this.CreatedDialog()
      }
    }
    .width('100%').height('100%')
  }

  @Builder
  TokenCard(token: AccessToken) {
    Column({ space: 8 }) {
      Row() {
        Column({ space: 2 }) {
          Text(token.name).fontSize(16).fontWeight(FontWeight.Bold).fontColor(this.theme.colors.text)
          Text(`${token.tokenPrefix}…`).fontSize(12).fontColor(this.theme.colors.textSecondary).fontFamily('monospace')
        }
        .layoutWeight(1).alignItems(HorizontalAlign.Start)

        Toggle({ type: ToggleType.Switch, isOn: token.enabled })
          .selectedColor(this.theme.colors.primary)
          .onChange((val: boolean) => {
            this.toggleEnabled(token, val);
          })
      }
      .width('100%')

      Text(`${t('accessToken.lastUsedAt')}: ${token.lastUsedAt ? formatTime(token.lastUsedAt) : t('accessToken.neverUsed')}`)
        .fontSize(12).fontColor(this.theme.colors.textSecondary)
      Text(`${t('accessToken.createdAt')}: ${formatTime(token.createdAt) || '-'}`)
        .fontSize(12).fontColor(this.theme.colors.textSecondary)

      Row({ space: 8 }) {
        Column() {
          Text(t('accessToken.rename'))
            .fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.primary)
        }
        .height(36).borderRadius(8)
        .padding({ left: 14, right: 14 })
        .border({ width: 1, color: this.theme.colors.primary })
        .justifyContent(FlexAlign.Center)
        .onClick(() => this.openRename(token))

        Column() {
          Text(t('common.delete'))
            .fontSize(13).fontWeight(FontWeight.Medium)
            .fontColor('#FF3B30')
        }
        .height(36).borderRadius(8)
        .padding({ left: 14, right: 14 })
        .border({ width: 1, color: '#FF3B30' })
        .justifyContent(FlexAlign.Center)
        .onClick(() => this.confirmDelete(token))
      }
      .width('100%')
      .margin({ top: 4 })
    }
    .width('100%')
    .padding(16)
    .borderRadius(12)
    .alignItems(HorizontalAlign.Start)
    .border({ width: 1, color: this.theme.colors.border })
    .backgroundColor(this.theme.colors.surface)
  }

  @Builder
  NameDialog() {
    Stack() {
      Column()
        .width('100%').height('100%')
        .backgroundColor('rgba(0, 0, 0, 0.5)')
        .onClick(() => this.closeDialog())

      Column({ space: 12 }) {
        Text(this.dialogMode === 'create' ? t('accessToken.createTitle') : t('accessToken.renameTitle'))
          .fontSize(17).fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .width('100%')
          .textAlign(TextAlign.Start)

        TextInput({ text: this.nameInput, placeholder: t('accessToken.namePlaceholder') })
          .fontSize(14)
          .fontColor(this.theme.colors.text)
          .placeholderColor(this.theme.colors.textSecondary)
          .backgroundColor(this.theme.colors.background)
          .borderRadius(8)
          .border({ width: 1, color: this.theme.colors.border })
          .padding({ left: 12, right: 12, top: 10, bottom: 10 })
          .width('100%')
          .maxLength(50)
          .onChange((val: string) => { this.nameInput = val; })

        Row({ space: 10 }) {
          Column() {
            Text(t('common.cancel'))
              .fontSize(15).fontWeight(FontWeight.Medium)
              .fontColor(this.theme.colors.text)
          }
          .layoutWeight(1).height(40).borderRadius(8)
          .backgroundColor(this.theme.colors.border)
          .justifyContent(FlexAlign.Center)
          .onClick(() => this.closeDialog())

          Column() {
            if (this.submitting) {
              LoadingProgress().width(20).height(20).color(this.theme.colors.onPrimary)
            } else {
              Text(t('common.confirm'))
                .fontSize(15).fontWeight(FontWeight.Medium)
                .fontColor(this.theme.colors.onPrimary)
            }
          }
          .layoutWeight(1).height(40).borderRadius(8)
          .backgroundColor(this.theme.colors.primary)
          .justifyContent(FlexAlign.Center)
          .opacity(this.submitting || this.nameInput.trim().length === 0 ? 0.6 : 1)
          .onClick(() => this.submitName())
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
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }

  @Builder
  CreatedDialog() {
    Stack() {
      Column()
        .width('100%').height('100%')
        .backgroundColor('rgba(0, 0, 0, 0.5)')

      Column({ space: 12 }) {
        Text(t('accessToken.createdTitle'))
          .fontSize(17).fontWeight(FontWeight.Bold)
          .fontColor(this.theme.colors.text)
          .width('100%')
          .textAlign(TextAlign.Start)

        Text(t('accessToken.createdHint'))
          .fontSize(13).fontColor(this.theme.colors.textSecondary)
          .width('100%')

        Text(this.createdToken)
          .fontSize(13).fontColor(this.theme.colors.text).fontFamily('monospace')
          .width('100%')
          .padding(12)
          .borderRadius(8)
          .backgroundColor(this.theme.colors.background)
          .border({ width: 1, color: this.theme.colors.border })

        Column() {
          Text(t('accessToken.copy'))
            .fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.primary)
        }
        .width('100%').height(40).borderRadius(8)
        .border({ width: 1, color: this.theme.colors.primary })
        .justifyContent(FlexAlign.Center)
        .onClick(() => this.copyCreatedToken())

        Column() {
          Text(t('accessToken.createdDone'))
            .fontSize(15).fontWeight(FontWeight.Medium)
            .fontColor(this.theme.colors.onPrimary)
        }
        .width('100%').height(40).borderRadius(8)
        .backgroundColor(this.theme.colors.primary)
        .justifyContent(FlexAlign.Center)
        .onClick(() => { this.createdToken = ''; })
      }
      .width('90%')
      .padding(20)
      .borderRadius(14)
      .backgroundColor(this.theme.colors.surface)
      .border({ width: 1, color: this.theme.colors.border })
    }
    .width('100%').height('100%')
    .padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp })
  }
}
