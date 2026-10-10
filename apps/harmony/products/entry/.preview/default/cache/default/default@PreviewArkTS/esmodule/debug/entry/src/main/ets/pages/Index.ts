if (!("finalizeConstruction" in ViewPU.prototype)) {
    Reflect.set(ViewPU.prototype, "finalizeConstruction", () => { });
}
interface Index_Params {
    showPrivacyDialog?: boolean;
    themeMode?: ThemeMode;
    theme?: Theme;
    statusBarHeightVp?: number;
    navBarHeightVp?: number;
}
import router from "@ohos:router";
import type common from "@ohos:app.ability.common";
import { buildTheme } from "@bundle:com.audiodock.app/entry@features_ui/Index";
import type { Theme, ThemeMode } from "@bundle:com.audiodock.app/entry@features_ui/Index";
import { kvStore } from "@bundle:com.audiodock.app/entry@features_storage/Index";
import { authStore } from "@bundle:com.audiodock.app/entry/ets/context/AuthStore";
import { PrivacyAgreementDialog } from "@bundle:com.audiodock.app/entry/ets/components/PrivacyAgreementDialog";
import hilog from "@ohos:hilog";
const DOMAIN = 0xA001;
const TAG = 'IndexRoute';
/** 与 mobile 的 PRIVACY_AGREEMENT_ACCEPTED_KEY 保持一致。 */
const PRIVACY_AGREEMENT_ACCEPTED_KEY = 'privacy_agreement_accepted';
class Index extends ViewPU {
    constructor(parent, params, __localStorage, elmtId = -1, paramsLambda = undefined, extraInfo) {
        super(parent, __localStorage, elmtId, extraInfo);
        if (typeof paramsLambda === "function") {
            this.paramsGenerator_ = paramsLambda;
        }
        this.__showPrivacyDialog = new ObservedPropertySimplePU(false, this, "showPrivacyDialog");
        this.__themeMode = this.createStorageLink('themeMode', 'light', "themeMode");
        this.__theme = new ObservedPropertyObjectPU(buildTheme('light'), this, "theme");
        this.__statusBarHeightVp = this.createStorageProp('statusBarHeightVp', 0, "statusBarHeightVp");
        this.__navBarHeightVp = this.createStorageProp('navBarHeightVp', 0, "navBarHeightVp");
        this.setInitiallyProvidedValue(params);
        this.declareWatch("themeMode", this.onThemeModeChange);
        this.finalizeConstruction();
    }
    setInitiallyProvidedValue(params: Index_Params) {
        if (params.showPrivacyDialog !== undefined) {
            this.showPrivacyDialog = params.showPrivacyDialog;
        }
        if (params.theme !== undefined) {
            this.theme = params.theme;
        }
    }
    updateStateVars(params: Index_Params) {
    }
    purgeVariableDependenciesOnElmtId(rmElmtId) {
        this.__showPrivacyDialog.purgeDependencyOnElmtId(rmElmtId);
        this.__themeMode.purgeDependencyOnElmtId(rmElmtId);
        this.__theme.purgeDependencyOnElmtId(rmElmtId);
        this.__statusBarHeightVp.purgeDependencyOnElmtId(rmElmtId);
        this.__navBarHeightVp.purgeDependencyOnElmtId(rmElmtId);
    }
    aboutToBeDeleted() {
        this.__showPrivacyDialog.aboutToBeDeleted();
        this.__themeMode.aboutToBeDeleted();
        this.__theme.aboutToBeDeleted();
        this.__statusBarHeightVp.aboutToBeDeleted();
        this.__navBarHeightVp.aboutToBeDeleted();
        SubscriberManager.Get().delete(this.id__());
        this.aboutToBeDeletedInternal();
    }
    private __showPrivacyDialog: ObservedPropertySimplePU<boolean>;
    get showPrivacyDialog() {
        return this.__showPrivacyDialog.get();
    }
    set showPrivacyDialog(newValue: boolean) {
        this.__showPrivacyDialog.set(newValue);
    }
    private __themeMode: ObservedPropertyAbstractPU<ThemeMode>;
    get themeMode() {
        return this.__themeMode.get();
    }
    set themeMode(newValue: ThemeMode) {
        this.__themeMode.set(newValue);
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
    onThemeModeChange(): void {
        this.theme = buildTheme(this.themeMode);
    }
    async aboutToAppear(): Promise<void> {
        hilog.info(DOMAIN, TAG, '[1] aboutToAppear entered');
        this.theme = buildTheme(this.themeMode);
        try {
            // 防御性初始化：框架可能在 EntryAbility 的异步 initialize() 完成 kvStore.init
            // 之前就加载本页，导致读取命中空的内存兜底、每次重启都误入数据源选择页。
            await kvStore.init(getContext(this) as common.UIAbilityContext);
        }
        catch (e) {
            hilog.warn(DOMAIN, TAG, `[1.5] kvStore.init: ${String(e)}`);
        }
        try {
            await authStore.loadFromStorage();
            hilog.info(DOMAIN, TAG, `[2] loadFromStorage done user=${String(authStore.state_.user)} server=${authStore.state_.serverAddress} token=${authStore.state_.token ? 'yes' : 'no'}`);
        }
        catch (e) {
            hilog.error(DOMAIN, TAG, `[2] loadFromStorage THREW: ${String(e)}`);
        }
        setTimeout(() => {
            hilog.info(DOMAIN, TAG, '[3] setTimeout fired');
            this.checkPrivacyAndNavigate();
        }, 0);
    }
    /** 首次启动且未同意过协议时先弹隐私协议弹窗，同意后再跳转（1:1 mobile 行为）。 */
    private async checkPrivacyAndNavigate(): Promise<void> {
        let accepted = '';
        try {
            const v = await kvStore.get(PRIVACY_AGREEMENT_ACCEPTED_KEY);
            accepted = v ?? '';
        }
        catch (e) {
            hilog.warn(DOMAIN, TAG, `[3.5] read privacy flag failed: ${String(e)}`);
        }
        if (accepted !== 'true') {
            hilog.info(DOMAIN, TAG, '[3.6] privacy not accepted, show dialog');
            this.showPrivacyDialog = true;
            return;
        }
        this.navigateByAuth();
    }
    private navigateByAuth(): void {
        let target = 'pages/SourceSelectPage';
        if (authStore.state_.token && authStore.state_.serverAddress)
            target = 'pages/RootShellPage';
        else if (authStore.state_.serverAddress)
            target = 'pages/LoginPage';
        hilog.info(DOMAIN, TAG, `[4] navigating to ${target}`);
        router.replaceUrl({ url: target }).then(() => {
            hilog.info(DOMAIN, TAG, `[5] replaceUrl resolved for ${target}`);
        }).catch((e: Error) => {
            hilog.error(DOMAIN, TAG, `[5] replaceUrl REJECTED for ${target}: ${e.message}`);
        });
    }
    private onAgree(): void {
        kvStore.set(PRIVACY_AGREEMENT_ACCEPTED_KEY, 'true').catch((e: Error) => {
            hilog.warn(DOMAIN, TAG, `save privacy flag failed: ${e.message}`);
        });
        this.showPrivacyDialog = false;
        this.navigateByAuth();
    }
    private onDisagree(): void {
        (getContext(this) as common.UIAbilityContext).terminateSelf();
    }
    /** 弹窗展示期间拦截返回键：用户必须明确选择"同意并继续"或"不同意"。 */
    onBackPress(): boolean {
        return this.showPrivacyDialog;
    }
    initialRender() {
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Stack.create();
            Stack.debugLine("products/entry/src/main/ets/pages/Index.ets(99:5)", "entry");
            Stack.width('100%');
            Stack.height('100%');
            Stack.backgroundColor(this.theme.colors.background);
            Stack.padding({ top: this.statusBarHeightVp, bottom: this.navBarHeightVp });
        }, Stack);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Column.create();
            Column.debugLine("products/entry/src/main/ets/pages/Index.ets(100:7)", "entry");
            Column.width('100%');
            Column.height('100%');
            Column.justifyContent(FlexAlign.Center);
        }, Column);
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            Text.create('AudioDock');
            Text.debugLine("products/entry/src/main/ets/pages/Index.ets(100:18)", "entry");
            Text.fontSize(28);
            Text.fontWeight(700);
        }, Text);
        Text.pop();
        Column.pop();
        this.observeComponentCreation2((elmtId, isInitialRender) => {
            If.create();
            if (this.showPrivacyDialog) {
                this.ifElseBranchUpdateFunction(0, () => {
                    this.observeComponentCreation2((elmtId, isInitialRender) => {
                        Column.create();
                        Column.debugLine("products/entry/src/main/ets/pages/Index.ets(104:9)", "entry");
                        Column.width('100%');
                        Column.height('100%');
                        Column.padding({ left: 32, right: 32 });
                        Column.backgroundColor('rgba(0,0,0,0.5)');
                        Column.justifyContent(FlexAlign.Center);
                        Column.alignItems(HorizontalAlign.Center);
                        Column.onClick(() => {
                            // 拦截点击穿透：用户必须通过按钮做出明确选择
                        });
                    }, Column);
                    {
                        this.observeComponentCreation2((elmtId, isInitialRender) => {
                            if (isInitialRender) {
                                let componentCall = new PrivacyAgreementDialog(this, {
                                    theme: this.theme,
                                    onAgree: (): void => this.onAgree(),
                                    onDisagree: (): void => this.onDisagree(),
                                }, undefined, elmtId, () => { }, { page: "products/entry/src/main/ets/pages/Index.ets", line: 105, col: 11 });
                                ViewPU.create(componentCall);
                                let paramsLambda = () => {
                                    return {
                                        theme: this.theme,
                                        onAgree: (): void => this.onAgree(),
                                        onDisagree: (): void => this.onDisagree()
                                    };
                                };
                                componentCall.paramsGenerator_ = paramsLambda;
                            }
                            else {
                                this.updateStateVarsOfChildByElmtId(elmtId, {
                                    theme: this.theme
                                });
                            }
                        }, { name: "PrivacyAgreementDialog" });
                    }
                    Column.pop();
                });
            }
            else {
                this.ifElseBranchUpdateFunction(1, () => {
                });
            }
        }, If);
        If.pop();
        Stack.pop();
    }
    rerender() {
        this.updateDirtyElements();
    }
    static getEntryName(): string {
        return "Index";
    }
}
registerNamedRoute(() => new Index(undefined, {}), "", { bundleName: "com.audiodock.app", moduleName: "entry", pagePath: "pages/Index", pageFullPath: "products/entry/src/main/ets/pages/Index", integratedHsp: "false", moduleType: "followWithHap" });
