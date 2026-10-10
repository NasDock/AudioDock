if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface LoginPage_Params {
    sourceType?: string;
    isLogin?: boolean;
    loading?: boolean;
    externalAddress?: string;
    internalAddress?: string;
    username?: string;
    password?: string;
    confirmPassword?: string;
    themeMode?: ThemeMode;
    langAtBuild?: string;
    theme?: Theme;
    statusBarHeightVp?: number;
    navBarHeightVp?: number;
}
import router from "@ohos:router";
import promptAction from "@ohos:promptAction";
import { buildTheme, type Theme, type ThemeMode } from "@bundle:com.audiodock.app/entry@features_ui/Index";
import { t, getLang } from "@bundle:com.audiodock.app/entry@features_i18n/Index";
import { HttpError } from "@bundle:com.audiodock.app/entry@features_network/Index";
import { kvStore } from "@bundle:com.audiodock.app/entry@features_storage/Index";
import { Logger } from "@bundle:com.audiodock.app/entry@audiodock_common/Index";
import { authStore } from "@bundle:com.audiodock.app/entry/ets/context/AuthStore";
import { SOURCEMAP, SOURCETIPSMAP, selectBestServer } from "@bundle:com.audiodock.app/entry/ets/utils/networkUtils";
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
class LoginPage extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__sourceType = new ObservedPropertySimplePU('AudioDock', this, "sourceType");
        this.__isLogin = new ObservedPropertySimplePU(true, this, "isLogin");
        this.__loading = new ObservedPropertySimplePU(false, this, "loading");
        this.__externalAddress = new ObservedPropertySimplePU('', this, "externalAddress");
        this.__internalAddress = new ObservedPropertySimplePU('', this, "internalAddress");
        this.__username = new ObservedPropertySimplePU('', this, "username");
        this.__password = new ObservedPropertySimplePU('', this, "password");
        this.__confirmPassword = new ObservedPropertySimplePU('', this, "confirmPassword");
        this.__themeMode = this.createStorageLink('themeMode', 'light', "themeMode");
        this.__langAtBuild = new ObservedPropertySimplePU(getLang(), this, "langAtBuild");
        this.__theme = new ObservedPropertyObjectPU(buildTheme('light'), this, "theme");
        this.__statusBarHeightVp = this.createStorageProp('statusBarHeightVp', 0, "statusBarHeightVp");
        this.__navBarHeightVp = this.createStorageProp('navBarHeightVp', 0, "navBarHeightVp");
        this.setInitiallyProvidedValue(params);
        this.declareWatch("themeMode", this.onThemeModeChange);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: LoginPage_Params) {
        if (params.sourceType !== undefined) {
            this.sourceType = params.sourceType;
        }
        if (params.isLogin !== undefined) {
            this.isLogin = params.isLogin;
        }
        if (params.loading !== undefined) {
            this.loading = params.loading;
        }
        if (params.externalAddress !== undefined) {
            this.externalAddress = params.externalAddress;
        }
        if (params.internalAddress !== undefined) {
            this.internalAddress = params.internalAddress;
        }
        if (params.username !== undefined) {
            this.username = params.username;
        }
        if (params.password !== undefined) {
            this.password = params.password;
        }
        if (params.confirmPassword !== undefined) {
            this.confirmPassword = params.confirmPassword;
        }
        if (params.langAtBuild !== undefined) {
            this.langAtBuild = params.langAtBuild;
        }
        if (params.theme !== undefined) {
            this.theme = params.theme;
        }
    }
    updateStateVars(params: LoginPage_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__sourceType.purgeDependencyOnElmtId(rmElmtId);
        this.__isLogin.purgeDependencyOnElmtId(rmElmtId);
        this.__loading.purgeDependencyOnElmtId(rmElmtId);
        this.__externalAddress.purgeDependencyOnElmtId(rmElmtId);
        this.__internalAddress.purgeDependencyOnElmtId(rmElmtId);
        this.__username.purgeDependencyOnElmtId(rmElmtId);
        this.__password.purgeDependencyOnElmtId(rmElmtId);
        this.__confirmPassword.purgeDependencyOnElmtId(rmElmtId);
        this.__themeMode.purgeDependencyOnElmtId(rmElmtId);
        this.__langAtBuild.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__statusBarHeightVp.purgeDependencyOnElmtId(rmElmtId);
        this.__navBarHeightVp.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__sourceType.aboutToBeDeleted();
        this.__isLogin.aboutToBeDeleted();
        this.__loading.aboutToBeDeleted();
        this.__externalAddress.aboutToBeDeleted();
        this.__internalAddress.aboutToBeDeleted();
        this.__username.aboutToBeDeleted();
        this.__password.aboutToBeDeleted();
        this.__confirmPassword.aboutToBeDeleted();
        this.__themeMode.aboutToBeDeleted();
        this.__langAtBuild.aboutToBeDeleted();
        this.__theme.aboutToBeDeleted();
        this.__statusBarHeightVp.aboutToBeDeleted();
        this.__navBarHeightVp.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __sourceType: ObservedPropertySimplePU<string>;
    get sourceType() {
        return this.__sourceType.get();
    }
    set sourceType(newValue: string) {
        this.__sourceType.set(newValue);
    }
    private __isLogin: ObservedPropertySimplePU<boolean>;
    get isLogin() {
        return this.__isLogin.get();
    }
    set isLogin(newValue: boolean) {
        this.__isLogin.set(newValue);
    }
    private __loading: ObservedPropertySimplePU<boolean>;
    get loading() {
        return this.__loading.get();
    }
    set loading(newValue: boolean) {
        this.__loading.set(newValue);
    }
    private __externalAddress: ObservedPropertySimplePU<string>;
    get externalAddress() {
        return this.__externalAddress.get();
    }
    set externalAddress(newValue: string) {
        this.__externalAddress.set(newValue);
    }
    private __internalAddress: ObservedPropertySimplePU<string>;
    get internalAddress() {
        return this.__internalAddress.get();
    }
    set internalAddress(newValue: string) {
        this.__internalAddress.set(newValue);
    }
    private __username: ObservedPropertySimplePU<string>;
    get username() {
        return this.__username.get();
    }
    set username(newValue: string) {
        this.__username.set(newValue);
    }
    private __password: ObservedPropertySimplePU<string>;
    get password() {
        return this.__password.get();
    }
    set password(newValue: string) {
        this.__password.set(newValue);
    }
    private __confirmPassword: ObservedPropertySimplePU<string>;
    get confirmPassword() {
        return this.__confirmPassword.get();
    }
    set confirmPassword(newValue: string) {
        this.__confirmPassword.set(newValue);
    }
    private __themeMode: ObservedPropertyAbstractPU<ThemeMode>;
    get themeMode() {
        return this.__themeMode.get();
    }
    set themeMode(newValue: ThemeMode) {
        this.__themeMode.set(newValue);
    }
    private __langAtBuild: ObservedPropertySimplePU<string>;
    get langAtBuild() {
        return this.__langAtBuild.get();
    }
    set langAtBuild(newValue: string) {
        this.__langAtBuild.set(newValue);
    }
    private __theme: ObservedPropertyObjectPU<Theme>;
    get theme() {
        return this.__theme.get();
    }
    set theme(newValue: Theme) {
        this.__theme.set(newValue);
    }
    // 沉浸式避让区高度（vp，services/systemBar publishAvoidArea 下发）
    private __statusBarHeightVp: ObservedPropertyAbstractPU<number>;
    get statusBarHeightVp() {
        return this.__statusBarHeightVp.get();
    }
    set statusBarHeightVp(newValue: number) {
        this.__statusBarHeightVp.set(newValue);
    }
    private __navBarHeightVp: ObservedPropertyAbstractPU<number>;
    get navBarHeightVp() {
        return this.__navBarHeightVp.get();
    }
    set navBarHeightVp(newValue: number) {
        this.__navBarHeightVp.set(newValue);
    }
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
            return { "id": 33554491, "type": 20000, params: [], "bundleName": "com.audiodock.app", "moduleName": "entry" };
        }
        if (this.sourceType === 'Emby') {
            return { "id": 33554485, "type": 20000, params: [], "bundleName": "com.audiodock.app", "moduleName": "entry" };
        }
        return { "id": 33554470, "type": 20000, params: [], "bundleName": "com.audiodock.app", "moduleName": "entry" };
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
                }
                else if (!Array.isArray(parsed)) {
                    const obj = parsed as Record<string, string>;
                    this.internalAddress = obj['internal'] ?? '';
                    this.externalAddress = obj['external'] ?? '';
                    const addr: string = obj['external'] || obj['internal'] || '';
                    if (addr) {
                        await this.restoreCredentials(addr);
                    }
                }
            }
            else if (this.sourceType === 'AudioDock') {
                this.internalAddress = 'http://localhost:3000';
            }
        }
        catch (e) {
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
        }
        catch (e) {
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
                    }
                    else {
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
            }
            catch (e) {
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
            }
            else {
                if (mappedType === 'subsonic') {
                    promptAction.showToast({ message: t('login.subsonicNoRegisterSupport') });
                    return;
                }
                await authStore.register({ username: this.username, password: this.password });
            }
            router.replaceUrl({ url: 'pages/RootShellPage' });
        }
        catch (e) {
            const errMsg: string = e instanceof HttpError ? e.message : String(e);
            Logger.e('LoginDiag', `submit failed err=${errMsg} type=${e instanceof HttpError ? `HttpError(${e.status})` : typeof e}`);
            promptAction.showToast({ message: errMsg });
        }
        finally {
            this.loading = false;
        }
    }
    FieldLabel(label: string, parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(label);
            Text.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(231:5)", "entry");
            Text.fontSize(14);
            Text.fontWeight(FontWeight.Medium);
            Text.fontColor(this.theme.colors.text);
            Text.textAlign(TextAlign.Start);
            Text.alignSelf(ItemAlign.Start);
            Text.margin({ bottom: 5, top: 4 });
        }, Text);
        Text.pop();
    }
    onPageShow(): void {
        // 语言可能在后台（语言页/系统设置）被修改：回显时若语言已变化，切换 if 分支重建整页。
        // 不能在隐藏时重建——@StorageProp 在后台更新触发的重建会导致路由页触摸失效，
        // 因此用 langAtBuild 把重建延迟到页面可见时。
        const cur = getLang();
        if (cur !== this.langAtBuild)
            this.langAtBuild = cur;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
            // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
            // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
            // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
            Column.create();
            Column.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(253:5)", "entry");
            // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
            // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
            // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
            // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
            Column.width('100%');
            // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
            // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
            // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
            // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
            Column.height('100%');
            // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
            // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
            // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
            // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
            Column.backgroundColor(this.theme.colors.background);
            // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
            // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
            // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
            // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
            Column.padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.langAtBuild === 'zh-CN') {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.LocalizedContent.bind(this)();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.LocalizedContent.bind(this)();
                });
            }
        }, If);
        If.pop();
        // 语言切换时重建整页：条件读取 langAtBuild 建立依赖（框架只追踪读取状态变量的表达式，
        // t() 是普通函数无法被追踪），语言变化使 if 分支切换，旧子树销毁、新子树重建，
        // 所有 t() 文案（含局部 @Builder 和 @Prop 传串的子组件）都按新语言重新求值。
        // 沉浸式避让：全屏布局下页面从物理 y=0 排版，外层 Column padding 避开状态栏/小横条
        Column.pop();
    }
    LocalizedContent(parent = null) {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(267:5)", "entry");
            Column.width('100%');
            Column.height('100%');
            Column.backgroundColor(this.theme.colors.background);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 顶部：切换类型
            Row.create();
            Row.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(269:7)", "entry");
            // 顶部：切换类型
            Row.width('100%');
            // 顶部：切换类型
            Row.padding({ left: 20, right: 20, top: 16 });
            // 顶部：切换类型
            Row.justifyContent(FlexAlign.Start);
        }, Row);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(t('loginForm.switchType'));
            Text.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(270:9)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.theme.colors.text);
            Text.padding(5);
            Text.onClick((): void => {
                router.replaceUrl({ url: 'pages/SourceSelectPage' });
            });
        }, Text);
        Text.pop();
        // 顶部：切换类型
        Row.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create();
            Scroll.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(282:7)", "entry");
            Scroll.layoutWeight(1);
            Scroll.scrollBar(BarState.Off);
            Scroll.align(Alignment.Top);
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(283:9)", "entry");
            Column.width('100%');
            Column.padding({ left: 24, right: 24 });
            Column.constraintSize({ maxWidth: 600 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // Logo + 标题
            Column.create();
            Column.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(285:11)", "entry");
            // Logo + 标题
            Column.width('100%');
            // Logo + 标题
            Column.alignItems(HorizontalAlign.Center);
            // Logo + 标题
            Column.margin({ top: 24, bottom: 16 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Image.create(this.logoResource());
            Image.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(286:13)", "entry");
            Image.width(80);
            Image.height(80);
            Image.borderRadius(16);
            Image.margin({ bottom: 20 });
        }, Image);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(`${this.sourceType} ${this.isLogin ? t('loginForm.login') : t('loginForm.register')}`);
            Text.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(291:13)", "entry");
            Text.fontSize(24);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.theme.colors.text);
            Text.textAlign(TextAlign.Center);
            Text.margin({ bottom: 8 });
        }, Text);
        Text.pop();
        // Logo + 标题
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 数据源说明
            Text.create(SOURCETIPSMAP[this.sourceType] ?? '');
            Text.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(303:11)", "entry");
            // 数据源说明
            Text.fontSize(13);
            // 数据源说明
            Text.fontColor(this.theme.colors.textSecondary);
            // 数据源说明
            Text.textAlign(TextAlign.Center);
            // 数据源说明
            Text.lineHeight(20);
            // 数据源说明
            Text.margin({ bottom: 16 });
        }, Text);
        // 数据源说明
        Text.pop();
        // 外网地址
        this.FieldLabel.bind(this)(t('loginForm.externalAddress'));
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: 'http://music.example.com', text: this.externalAddress });
            TextInput.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(312:11)", "entry");
            TextInput.onChange((v: string): void => { this.externalAddress = v; });
            TextInput.height(50);
            TextInput.fontSize(16);
            TextInput.fontColor(this.theme.colors.text);
            TextInput.placeholderColor(this.theme.colors.textSecondary);
            TextInput.backgroundColor(this.theme.colors.surface);
            TextInput.borderRadius(12);
            TextInput.border({ width: 1, color: this.theme.colors.border });
            TextInput.padding({ left: 15, right: 15 });
            TextInput.margin({ bottom: 16 });
        }, TextInput);
        // 内网地址
        this.FieldLabel.bind(this)(t('loginForm.internalAddress'));
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: 'http://192.168.x.x:3000', text: this.internalAddress });
            TextInput.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(326:11)", "entry");
            TextInput.onChange((v: string): void => { this.internalAddress = v; });
            TextInput.height(50);
            TextInput.fontSize(16);
            TextInput.fontColor(this.theme.colors.text);
            TextInput.placeholderColor(this.theme.colors.textSecondary);
            TextInput.backgroundColor(this.theme.colors.surface);
            TextInput.borderRadius(12);
            TextInput.border({ width: 1, color: this.theme.colors.border });
            TextInput.padding({ left: 15, right: 15 });
            TextInput.margin({ bottom: 16 });
        }, TextInput);
        // 用户名
        this.FieldLabel.bind(this)(t('login.username'));
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: '请输入用户名', text: this.username });
            TextInput.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(340:11)", "entry");
            TextInput.onChange((v: string): void => { this.username = v; });
            TextInput.height(50);
            TextInput.fontSize(16);
            TextInput.fontColor(this.theme.colors.text);
            TextInput.placeholderColor(this.theme.colors.textSecondary);
            TextInput.backgroundColor(this.theme.colors.surface);
            TextInput.borderRadius(12);
            TextInput.border({ width: 1, color: this.theme.colors.border });
            TextInput.padding({ left: 15, right: 15 });
            TextInput.margin({ bottom: 16 });
        }, TextInput);
        // 密码
        this.FieldLabel.bind(this)(t('login.password'));
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            TextInput.create({ placeholder: '请输入密码', text: this.password });
            TextInput.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(354:11)", "entry");
            TextInput.onChange((v: string): void => { this.password = v; });
            TextInput.type(InputType.Password);
            TextInput.height(50);
            TextInput.fontSize(16);
            TextInput.fontColor(this.theme.colors.text);
            TextInput.placeholderColor(this.theme.colors.textSecondary);
            TextInput.backgroundColor(this.theme.colors.surface);
            TextInput.borderRadius(12);
            TextInput.border({ width: 1, color: this.theme.colors.border });
            TextInput.padding({ left: 15, right: 15 });
            TextInput.margin({ bottom: 16 });
        }, TextInput);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            // 确认密码（仅注册模式）
            if (!this.isLogin) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.FieldLabel.bind(this)(t('loginForm.confirmPasswordLabel'));
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        TextInput.create({ placeholder: '请再次输入密码', text: this.confirmPassword });
                        TextInput.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(370:13)", "entry");
                        TextInput.onChange((v: string): void => { this.confirmPassword = v; });
                        TextInput.type(InputType.Password);
                        TextInput.height(50);
                        TextInput.fontSize(16);
                        TextInput.fontColor(this.theme.colors.text);
                        TextInput.placeholderColor(this.theme.colors.textSecondary);
                        TextInput.backgroundColor(this.theme.colors.surface);
                        TextInput.borderRadius(12);
                        TextInput.border({ width: 1, color: this.theme.colors.border });
                        TextInput.padding({ left: 15, right: 15 });
                        TextInput.margin({ bottom: 16 });
                    }, TextInput);
                });
            }
            // 提交按钮
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 提交按钮
            Button.createWithChild();
            Button.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(385:11)", "entry");
            // 提交按钮
            Button.width('100%');
            // 提交按钮
            Button.height(50);
            // 提交按钮
            Button.backgroundColor(this.theme.colors.primary);
            // 提交按钮
            Button.borderRadius(14);
            // 提交按钮
            Button.enabled(!this.loading);
            // 提交按钮
            Button.margin({ top: 8 });
            // 提交按钮
            Button.onClick((): void => { this.handleSubmit(); });
        }, Button);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.loading) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        LoadingProgress.create();
                        LoadingProgress.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(387:15)", "entry");
                        LoadingProgress.width(24);
                        LoadingProgress.height(24);
                        LoadingProgress.color(this.theme.colors.onPrimary);
                    }, LoadingProgress);
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Text.create(this.isLogin ? t('loginForm.login') : t('loginForm.register'));
                        Text.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(392:15)", "entry");
                        Text.fontSize(16);
                        Text.fontWeight(FontWeight.Medium);
                        Text.fontColor(this.theme.colors.onPrimary);
                    }, Text);
                    Text.pop();
                });
            }
        }, If);
        If.pop();
        // 提交按钮
        Button.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 登录/注册切换
            Text.create(this.isLogin ? t('login.noAccount') : t('login.hasAccount'));
            Text.debugLine("products/entry/src/main/ets/pages/LoginPage.ets(407:11)", "entry");
            // 登录/注册切换
            Text.fontSize(14);
            // 登录/注册切换
            Text.fontColor(this.theme.colors.primary);
            // 登录/注册切换
            Text.textAlign(TextAlign.Center);
            // 登录/注册切换
            Text.width('100%');
            // 登录/注册切换
            Text.margin({ top: 16, bottom: 32 });
            // 登录/注册切换
            Text.onClick((): void => { this.isLogin = !this.isLogin; });
        }, Text);
        // 登录/注册切换
        Text.pop();
        Column.pop();
        Scroll.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    static getEntryName(): string {
        return "LoginPage";
    }
}
registerNamedRoute(() => new LoginPage(undefined, {}), "", { bundleName: "com.audiodock.app", moduleName: "entry", pagePath: "pages/LoginPage", pageFullPath: "products/entry/src/main/ets/pages/LoginPage", integratedHsp: "false", moduleType: "followWithHap" });
