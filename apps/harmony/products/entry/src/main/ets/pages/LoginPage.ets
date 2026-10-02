import router from '@ohos.router';
import promptAction from '@ohos.promptAction';
import { buildTheme, type Theme, type ThemeMode } from 'features_ui';
import { t, getLang } from 'features_i18n';
import { HttpError } from 'features_network';
import { kvStore } from 'features_storage';
import { Logger } from 'audiodock_common';
import { authStore } from '../context/AuthStore';
import { SOURCEMAP, SOURCETIPSMAP, selectBestServer } from '../utils/networkUtils';

interface Creds {
  username?: string;
  password?: string;
}

class SourceConfigItem {
  id: string = '';
  internal: string = '';
  external: string = '';
  name: string = '';
}

@Entry
@Component
struct LoginPage {
  @State sourceType: string = 'AudioDock';
  @State isLogin: boolean = true;
  @State loading: boolean = false;
  @State externalAddress: string = '';
  @State internalAddress: string = '';
  @State username: string = '';
  @State password: string = '';
  @State confirmPassword: string = '';
  @StorageLink('themeMode') @Watch('onThemeModeChange') themeMode: ThemeMode = 'light';
  @State private langAtBuild: string = getLang();
  @State theme: Theme = buildTheme('light');
  // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
  @StorageProp('statusBarHeightVp') statusBarHeightVp: number = 0;
  @StorageProp('navBarHeightVp') navBarHeightVp: number = 0;

  aboutToAppear(): void {
    this.theme = buildTheme(this.themeMode);
    const params = router.getParams() as Record<string, string> | undefined;
    const rawType: string = params?.['sourceType'] ?? 'AudioDock';
    this.sourceType = this.normalizeSourceType(rawType);
    this.loadSourceConfig();
  }

  onThemeModeChange(): void {
    this.theme = buildTheme(this.themeMode);
  }

  // 归一化数据源类型为 mobile 端的大写展示形式（AudioDock / Subsonic / Emby）
  private normalizeSourceType(raw: string): string {
    const lower: string = raw.toLowerCase();
    if (lower === 'subsonic') {
      return 'Subsonic';
    }
    if (lower === 'emby') {
      return 'Emby';
    }
    return 'AudioDock';
  }

  private logoResource(): Resource {
    if (this.sourceType === 'Subsonic') {
      return $r('app.media.subsonic');
    }
    if (this.sourceType === 'Emby') {
      return $r('app.media.emby');
    }
    return $r('app.media.logo');
  }

  // 对齐 mobile loadSourceConfig：恢复上次填写的地址与凭据（兼容数组与旧对象两种格式）
  private async loadSourceConfig(): Promise<void> {
    try {
      const raw: string | null = await kvStore.get(`sourceConfig_${this.sourceType}`);
      if (raw) {
        const parsed: Object = JSON.parse(raw);
        if (Array.isArray(parsed) && (parsed as Object[]).length > 0) {
          const arr = parsed as Array<Record<string, string>>;
          const last = arr[arr.length - 1];
          this.internalAddress = last['internal'] ?? '';
          this.externalAddress = last['external'] ?? '';
          const addr: string = last['external'] || last['internal'] || '';
          if (addr) {
            await this.restoreCredentials(addr);
          }
        } else if (!Array.isArray(parsed)) {
          const obj = parsed as Record<string, string>;
          this.internalAddress = obj['internal'] ?? '';
          this.externalAddress = obj['external'] ?? '';
          const addr: string = obj['external'] || obj['internal'] || '';
          if (addr) {
            await this.restoreCredentials(addr);
          }
        }
      } else if (this.sourceType === 'AudioDock') {
        this.internalAddress = 'http://localhost:3000';
      }
    } catch (e) {
      Logger.w('LoginPage', `load source config failed: ${String(e)}`);
    }
  }

  private async restoreCredentials(address: string): Promise<void> {
    try {
      const raw: string | null = await kvStore.get(`creds_${this.sourceType}_${address}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Creds;
        if (parsed.username) {
          this.username = parsed.username;
        }
        if (parsed.password) {
          this.password = parsed.password;
        }
      }
    } catch (e) {
      Logger.w('LoginPage', `restore credentials failed: ${String(e)}`);
    }
  }

  private async handleSubmit(): Promise<void> {
    const internal: string = this.internalAddress.trim();
    const external: string = this.externalAddress.trim();
    Logger.i('LoginDiag', `submit start sourceType=${this.sourceType} isLogin=${this.isLogin} internal=${internal} external=${external} username=${this.username}`);
    if (!internal && !external) {
      promptAction.showToast({ message: '请至少输入一个数据源地址（内网或外网）' });
      return;
    }
    if (!this.username || !this.password) {
      promptAction.showToast({ message: t('login.fillUsernameAndPassword') });
      return;
    }
    if (!this.isLogin && this.password !== this.confirmPassword) {
      promptAction.showToast({ message: t('login.passwordMismatch') });
      return;
    }

    this.loading = true;
    try {
      const bestAddress: string | null = await selectBestServer(internal, external, this.sourceType);
      Logger.i('LoginDiag', `bestAddress=${bestAddress ?? 'null'} mappedType=${SOURCEMAP[this.sourceType] || 'audiodock'}`);
      if (!bestAddress) {
        promptAction.showToast({ message: t('login.cannotConnectAnyAddress') });
        return;
      }

      const mappedType: string = SOURCEMAP[this.sourceType] || 'audiodock';

      // 持久化数据源配置（数组格式，对齐 mobile）与凭据
      const configKey: string = `sourceConfig_${this.sourceType}`;
      const existingStr: string | null = await kvStore.get(configKey);
      let existingConfigs: SourceConfigItem[] = [];
      try {
        if (existingStr) {
          const parsed: Object = JSON.parse(existingStr);
          if (Array.isArray(parsed)) {
            const arr = parsed as Array<Record<string, string>>;
            for (const item of arr) {
              const cfg = new SourceConfigItem();
              cfg.id = item['id'] ?? Date.now().toString();
              cfg.internal = item['internal'] ?? '';
              cfg.external = item['external'] ?? '';
              cfg.name = item['name'] ?? '';
              existingConfigs.push(cfg);
            }
          } else {
            // 迁移：旧对象格式转为数组
            const obj = parsed as Record<string, string>;
            const legacy = new SourceConfigItem();
            legacy.id = Date.now().toString();
            legacy.internal = obj['internal'] ?? '';
            legacy.external = obj['external'] ?? '';
            legacy.name = '默认服务器';
            existingConfigs.push(legacy);
          }
        }
      } catch (e) {
        existingConfigs = [];
      }

      let matched: boolean = false;
      for (const c of existingConfigs) {
        if (c.internal === internal && c.external === external) {
          matched = true;
          break;
        }
      }
      if (!matched) {
        const item = new SourceConfigItem();
        item.id = Date.now().toString();
        item.internal = internal;
        item.external = external;
        item.name = `服务器 ${existingConfigs.length + 1}`;
        existingConfigs.push(item);
      }

      await kvStore.set(configKey, JSON.stringify(existingConfigs));
      const creds: Creds = { username: this.username, password: this.password };
      await kvStore.set(`creds_${this.sourceType}_${bestAddress}`, JSON.stringify(creds));

      // 切换服务器：写入地址与类型后重载认证状态（baseURL + sourceType + 凭据）
      await kvStore.set('serverAddress', bestAddress);
      await kvStore.set('selectedSourceType', mappedType);
      await authStore.loadFromStorage();

      if (this.isLogin) {
        await authStore.login({ username: this.username, password: this.password });
      } else {
        if (mappedType === 'subsonic') {
          promptAction.showToast({ message: t('login.subsonicNoRegisterSupport') });
          return;
        }
        await authStore.register({ username: this.username, password: this.password });
      }

      router.replaceUrl({ url: 'pages/RootShellPage' });
    } catch (e) {
      const errMsg: string = e instanceof HttpError ? e.message : String(e);
      Logger.e('LoginDiag', `submit failed err=${errMsg} type=${e instanceof HttpError ? `HttpError(${e.status})` : typeof e}`);
      promptAction.showToast({ message: errMsg });
    } finally {
      this.loading = false;
    }
  }

  @Builder
  FieldLabel(label: string) {
    Text(label)
      .fontSize(14)
      .fontWeight(FontWeight.Medium)
      .fontColor(this.theme.colors.text)
      .textAlign(TextAlign.Start)
      .alignSelf(ItemAlign.Start)
      .margin({ bottom: 5, top: 4 })
  }

  onPageShow(): void {
    // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
    // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效，
    // 因此用 langAtBuild 把重建延迟到页面可见时。
    const cur = getLang();
    if (cur !== this.langAtBuild) this.langAtBuild = cur;
  }

  build() {
    // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
    // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
    // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
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

  @Builder
  LocalizedContent() {
    Column() {
      // 顶部：切换类型
      Row() {
        Text(t('loginForm.switchType'))
          .fontSize(12)
          .fontColor(this.theme.colors.text)
          .padding(5)
          .onClick((): void => {
            router.replaceUrl({ url: 'pages/SourceSelectPage' });
          })
      }
      .width('100%')
      .padding({ left: 20, right: 20, top: 16 })
      .justifyContent(FlexAlign.Start)

      Scroll() {
        Column() {
          // Logo + 标题
          Column() {
            Image(this.logoResource())
              .width(80)
              .height(80)
              .borderRadius(16)
              .margin({ bottom: 20 })
            Text(`${this.sourceType} ${this.isLogin ? t('loginForm.login') : t('loginForm.register')}`)
              .fontSize(24)
              .fontWeight(FontWeight.Bold)
              .fontColor(this.theme.colors.text)
              .textAlign(TextAlign.Center)
              .margin({ bottom: 8 })
          }
          .width('100%')
          .alignItems(HorizontalAlign.Center)
          .margin({ top: 24, bottom: 16 })

          // 数据源说明
          Text(SOURCETIPSMAP[this.sourceType] ?? '')
            .fontSize(13)
            .fontColor(this.theme.colors.textSecondary)
            .textAlign(TextAlign.Center)
            .lineHeight(20)
            .margin({ bottom: 16 })

          // 外网地址
          this.FieldLabel(t('loginForm.externalAddress'));
          TextInput({ placeholder: 'http://music.example.com', text: this.externalAddress })
            .onChange((v: string): void => { this.externalAddress = v; })
            .height(50)
            .fontSize(16)
            .fontColor(this.theme.colors.text)
            .placeholderColor(this.theme.colors.textSecondary)
            .backgroundColor(this.theme.colors.surface)
            .borderRadius(12)
            .border({ width: 1, color: this.theme.colors.border })
            .padding({ left: 15, right: 15 })
            .margin({ bottom: 16 })

          // 内网地址
          this.FieldLabel(t('loginForm.internalAddress'));
          TextInput({ placeholder: 'http://192.168.x.x:3000', text: this.internalAddress })
            .onChange((v: string): void => { this.internalAddress = v; })
            .height(50)
            .fontSize(16)
            .fontColor(this.theme.colors.text)
            .placeholderColor(this.theme.colors.textSecondary)
            .backgroundColor(this.theme.colors.surface)
            .borderRadius(12)
            .border({ width: 1, color: this.theme.colors.border })
            .padding({ left: 15, right: 15 })
            .margin({ bottom: 16 })

          // 用户名
          this.FieldLabel(t('login.username'));
          TextInput({ placeholder: '请输入用户名', text: this.username })
            .onChange((v: string): void => { this.username = v; })
            .height(50)
            .fontSize(16)
            .fontColor(this.theme.colors.text)
            .placeholderColor(this.theme.colors.textSecondary)
            .backgroundColor(this.theme.colors.surface)
            .borderRadius(12)
            .border({ width: 1, color: this.theme.colors.border })
            .padding({ left: 15, right: 15 })
            .margin({ bottom: 16 })

          // 密码
          this.FieldLabel(t('login.password'));
          TextInput({ placeholder: '请输入密码', text: this.password })
            .onChange((v: string): void => { this.password = v; })
            .type(InputType.Password)
            .height(50)
            .fontSize(16)
            .fontColor(this.theme.colors.text)
            .placeholderColor(this.theme.colors.textSecondary)
            .backgroundColor(this.theme.colors.surface)
            .borderRadius(12)
            .border({ width: 1, color: this.theme.colors.border })
            .padding({ left: 15, right: 15 })
            .margin({ bottom: 16 })

          // 确认密码（仅注册模式）
          if (!this.isLogin) {
            this.FieldLabel(t('loginForm.confirmPasswordLabel'));
            TextInput({ placeholder: '请再次输入密码', text: this.confirmPassword })
              .onChange((v: string): void => { this.confirmPassword = v; })
              .type(InputType.Password)
              .height(50)
              .fontSize(16)
              .fontColor(this.theme.colors.text)
              .placeholderColor(this.theme.colors.textSecondary)
              .backgroundColor(this.theme.colors.surface)
              .borderRadius(12)
              .border({ width: 1, color: this.theme.colors.border })
              .padding({ left: 15, right: 15 })
              .margin({ bottom: 16 })
          }

          // 提交按钮
          Button() {
            if (this.loading) {
              LoadingProgress()
                .width(24)
                .height(24)
                .color(this.theme.colors.onPrimary)
            } else {
              Text(this.isLogin ? t('loginForm.login') : t('loginForm.register'))
                .fontSize(16)
                .fontWeight(FontWeight.Medium)
                .fontColor(this.theme.colors.onPrimary)
            }
          }
          .width('100%')
          .height(50)
          .backgroundColor(this.theme.colors.primary)
          .borderRadius(14)
          .enabled(!this.loading)
          .margin({ top: 8 })
          .onClick((): void => { this.handleSubmit(); })

          // 登录/注册切换
          Text(this.isLogin ? t('login.noAccount') : t('login.hasAccount'))
            .fontSize(14)
            .fontColor(this.theme.colors.primary)
            .textAlign(TextAlign.Center)
            .width('100%')
            .margin({ top: 16, bottom: 32 })
            .onClick((): void => { this.isLogin = !this.isLogin; })
        }
        .width('100%')
        .padding({ left: 24, right: 24 })
        .constraintSize({ maxWidth: 600 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(this.theme.colors.background)
  }
}
