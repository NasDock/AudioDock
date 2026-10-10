if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface SourceSelectPage_Params {
    themeMode?: ThemeMode;
    langAtBuild?: string;
    theme?: Theme;
    statusBarHeightVp?: number;
    navBarHeightVp?: number;
}
import router from "@ohos:router";
import { buildTheme, type Theme, type ThemeMode } from "@bundle:com.audiodock.app/entry@features_ui/Index";
import { t, getLang } from "@bundle:com.audiodock.app/entry@features_i18n/Index";
import { SOURCEMAP, SOURCETIPSMAP } from "@bundle:com.audiodock.app/entry/ets/utils/networkUtils";
class SourceSelectPage extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__themeMode = this.createStorageLink('themeMode', 'light', "themeMode");
        this.__langAtBuild = new ObservedPropertySimplePU(getLang(), this, "langAtBuild");
        this.__theme = new ObservedPropertyObjectPU(buildTheme('light'), this, "theme");
        this.__statusBarHeightVp = this.createStorageProp('statusBarHeightVp', 0, "statusBarHeightVp");
        this.__navBarHeightVp = this.createStorageProp('navBarHeightVp', 0, "navBarHeightVp");
        this.setInitiallyProvidedValue(params);
        this.declareWatch("themeMode", this.onThemeModeChange);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: SourceSelectPage_Params) {
        if (params.langAtBuild !== undefined) {
            this.langAtBuild = params.langAtBuild;
        }
        if (params.theme !== undefined) {
            this.theme = params.theme;
        }
    }
    updateStateVars(params: SourceSelectPage_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__themeMode.purgeDependencyOnElmtId(rmElmtId);
        this.__langAtBuild.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__statusBarHeightVp.purgeDependencyOnElmtId(rmElmtId);
        this.__navBarHeightVp.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__themeMode.aboutToBeDeleted();
        this.__langAtBuild.aboutToBeDeleted();
        this.__theme.aboutToBeDeleted();
        this.__statusBarHeightVp.aboutToBeDeleted();
        this.__navBarHeightVp.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
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
    }
    onThemeModeChange(): void {
        this.theme = buildTheme(this.themeMode);
    }
    private logoResource(key: string): Resource {
        if (key === 'Subsonic') {
            return { "id": 33554491, "type": 20000, params: [], "bundleName": "com.audiodock.app", "moduleName": "entry" };
        }
        if (key === 'Emby') {
            return { "id": 33554485, "type": 20000, params: [], "bundleName": "com.audiodock.app", "moduleName": "entry" };
        }
        return { "id": 33554470, "type": 20000, params: [], "bundleName": "com.audiodock.app", "moduleName": "entry" };
    }
    private handleSelect(key: string): void {
        router.pushUrl({ url: 'pages/LoginPage', params: { sourceType: key } });
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
            Column.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(56:5)", "entry");
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
            Column.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(70:5)", "entry");
            Column.width('100%');
            Column.height('100%');
            Column.backgroundColor(this.theme.colors.background);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Scroll.create();
            Scroll.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(71:7)", "entry");
            Scroll.layoutWeight(1);
            Scroll.scrollBar(BarState.Off);
            Scroll.align(Alignment.Top);
        }, Scroll);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(72:9)", "entry");
            Column.width('100%');
            Column.padding({ left: 20, right: 20, bottom: 40 });
            Column.constraintSize({ maxWidth: 600 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 顶部：居中 Logo + 标题 + 副标题
            Column.create();
            Column.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(74:11)", "entry");
            // 顶部：居中 Logo + 标题 + 副标题
            Column.width('100%');
            // 顶部：居中 Logo + 标题 + 副标题
            Column.alignItems(HorizontalAlign.Center);
            // 顶部：居中 Logo + 标题 + 副标题
            Column.margin({ top: 40, bottom: 40 });
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Image.create({ "id": 33554470, "type": 20000, params: [], "bundleName": "com.audiodock.app", "moduleName": "entry" });
            Image.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(75:13)", "entry");
            Image.width(100);
            Image.height(100);
            Image.borderRadius(16);
            Image.margin({ bottom: 20 });
        }, Image);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(t('loginSelect.title'));
            Text.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(80:13)", "entry");
            Text.fontSize(18);
            Text.fontWeight(FontWeight.Bold);
            Text.fontColor(this.theme.colors.text);
            Text.margin({ bottom: 10 });
        }, Text);
        Text.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create(t('loginSelect.subtitle'));
            Text.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(85:13)", "entry");
            Text.fontSize(12);
            Text.fontColor(this.theme.colors.textSecondary);
            Text.textAlign(TextAlign.Center);
        }, Text);
        Text.pop();
        // 顶部：居中 Logo + 标题 + 副标题
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            // 数据源卡片列表
            Column.create({ space: 15 });
            Column.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(95:11)", "entry");
            // 数据源卡片列表
            Column.width('100%');
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            ForEach.create();
            const forEachItemGenFunction = _item => {
                const key = _item;
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Row.create();
                    Row.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(97:15)", "entry");
                    Row.width('100%');
                    Row.padding(20);
                    Row.borderRadius(16);
                    Row.borderWidth(1);
                    Row.borderColor(this.theme.colors.border);
                    Row.backgroundColor(this.theme.colors.surface);
                    Row.onClick(() => this.handleSelect(key));
                }, Row);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Image.create(this.logoResource(key));
                    Image.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(98:17)", "entry");
                    Image.width(50);
                    Image.height(50);
                    Image.margin({ right: 15 });
                }, Image);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Column.create();
                    Column.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(102:17)", "entry");
                    Column.layoutWeight(1);
                    Column.alignItems(HorizontalAlign.Start);
                }, Column);
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(key);
                    Text.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(103:19)", "entry");
                    Text.fontSize(18);
                    Text.fontWeight(FontWeight.Bold);
                    Text.fontColor(this.theme.colors.text);
                    Text.margin({ bottom: 4 });
                }, Text);
                Text.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create(SOURCETIPSMAP[key] ?? '');
                    Text.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(108:19)", "entry");
                    Text.fontSize(12);
                    Text.fontColor(this.theme.colors.textSecondary);
                    Text.maxLines(2);
                    Text.textOverflow({ overflow: TextOverflow.Ellipsis });
                }, Text);
                Text.pop();
                Column.pop();
                this.observeComponentCreation2((elmtId, isInitialRender) => {
                    Text.create('›');
                    Text.debugLine("products/entry/src/main/ets/pages/SourceSelectPage.ets(116:17)", "entry");
                    Text.fontSize(28);
                    Text.fontColor(this.theme.colors.text);
                    Text.margin({ left: 10 });
                }, Text);
                Text.pop();
                Row.pop();
            };
            this.forEachUpdateFunction(elmtId, Object.keys(SOURCEMAP), forEachItemGenFunction, (key: string) => key, false, false);
        }, ForEach);
        ForEach.pop();
        // 数据源卡片列表
        Column.pop();
        Column.pop();
        Scroll.pop();
        Column.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    static getEntryName(): string {
        return "SourceSelectPage";
    }
}
registerNamedRoute(() => new SourceSelectPage(undefined, {}), "", { bundleName: "com.audiodock.app", moduleName: "entry", pagePath: "pages/SourceSelectPage", pageFullPath: "products/entry/src/main/ets/pages/SourceSelectPage", integratedHsp: "false", moduleType: "followWithHap" });
