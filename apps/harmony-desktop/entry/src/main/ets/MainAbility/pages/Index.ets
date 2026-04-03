// AudioDock HarmonyOS Desktop - Main WebView Page
import web_webview from '@ohos.web.webview';
import window from '@ohos.window';
import hilog from '@ohos.hilog';
import { webView } from '@kit.ArkWeb';
import { BusinessError } from '@kit.BasicServicesKit';

const TAG = 'AudioDock_Index';
const DOMAIN = 0x0B01;

// 本地 Web 资源的基础路径
const LOCAL_BASE_URL = 'file://' + globalThis.filesDir + '/assets/index.html';
// 开发环境服务器地址（可配置）
const DEV_SERVER_URL = 'http://localhost:5173';
// 是否使用开发服务器模式
const USE_DEV_SERVER = false;

@Entry
@Component
struct Index {
  @State webController: web_webview.WebviewController = new web_webview.WebviewController();
  @State isLoading: boolean = true;
  @State loadingProgress: number = 0;
  @State errorMsg: string = '';
  private appController: web_webview.WebViewController | null = null;

  aboutToAppear() {
    hilog.info(DOMAIN, TAG, 'Index page aboutToAppear');
    this.appController = new web_webview.WebviewController();
  }

  build() {
    Stack() {
      // WebView 加载 Web 应用
      Web({
        src: USE_DEV_SERVER ? DEV_SERVER_URL : $rawfile('index.html'),
        controller: this.appController,
        renderMode: webView.RenderMode.FORCE_DARK_MODE,
        enableNativeMediaPlayer: true,
        mediaPlayGestureAccess: true,
        allowWindowOpenFromBrowser: false,
        javaScriptAccess: true,
        // 允许访问 file 协议的 cookie
        allowCrossOriginResourcesAccess: true,
        allowFileAccess: true,
        // 允许访问本地文件
        fileAccess: true,
        // 允许 DOM 存储
        domStorageAccess: true,
        // 允许地理位置
        geolocationAccess: true,
        // 允许新窗口
        allowNewWindows: false,
        // 语音合成
        speakable: true,
        // 支持中文
        localeScript: 'zh_CN',
      })
        .width('100%')
        .height('100%')
        .backgroundColor('#0F0F0F')
        .javaScriptProxy({
          object: {
            // 暴露给 Web 端的原生能力
            platform: 'harmony',
            getDeviceId: () => {
              return 'harmony-desktop';
            },
            getPlatformInfo: () => {
              return JSON.stringify({
                platform: 'harmony-desktop',
                version: '1.0.84',
                arch: 'ArkUI',
              });
            },
            setWindowTitle: (title: string) => {
              hilog.info(DOMAIN, TAG, `Set window title: ${title}`);
            },
            // 获取屏幕信息
            getScreenInfo: () => {
              try {
                let windowInfo = AppStorage.get<window.Window>();
                return JSON.stringify({
                  width: 1280,
                  height: 800,
                  scale: 1.0,
                  densityDPI: 160,
                });
              } catch (e) {
                return JSON.stringify({ width: 1280, height: 800 });
              }
            },
            // 最小化窗口
            minimizeWindow: () => {
              try {
                let context = getContext(this);
                window.getLastWindow(context).then((win) => {
                  win.minimize().catch((err: BusinessError) => {
                    hilog.error(DOMAIN, TAG, `minimizeWindow failed: ${JSON.stringify(err)}`);
                  });
                });
              } catch (e) {
                hilog.error(DOMAIN, TAG, `minimizeWindow error: ${JSON.stringify(e)}`);
              }
            },
            // 最大化窗口
            maximizeWindow: () => {
              try {
                let context = getContext(this);
                window.getLastWindow(context).then((win) => {
                  win.maximize().catch((err: BusinessError) => {
                    hilog.error(DOMAIN, TAG, `maximizeWindow failed: ${JSON.stringify(err)}`);
                  });
                });
              } catch (e) {
                hilog.error(DOMAIN, TAG, `maximizeWindow error: ${JSON.stringify(e)}`);
              }
            },
            // 关闭窗口
            closeWindow: () => {
              try {
                let context = getContext(this);
                window.getLastWindow(context).then((win) => {
                  win.destroyWindow().catch((err: BusinessError) => {
                    hilog.error(DOMAIN, TAG, `closeWindow failed: ${JSON.stringify(err)}`);
                  });
                });
              } catch (e) {
                hilog.error(DOMAIN, TAG, `closeWindow error: ${JSON.stringify(e)}`);
              }
            },
          },
          name: 'nativeBridge',
          methodList: [
            'platform',
            'getDeviceId',
            'getPlatformInfo',
            'setWindowTitle',
            'getScreenInfo',
            'minimizeWindow',
            'maximizeWindow',
            'closeWindow',
          ],
          controller: this.appController,
        })
        .onPageBegin((event) => {
          hilog.info(DOMAIN, TAG, 'Page begin loading');
          this.isLoading = true;
        })
        .onPageEnd((event) => {
          hilog.info(DOMAIN, TAG, 'Page end loading');
          this.isLoading = false;
          // 设置暗色模式
          this.appController.setForceDarkAccess(true);
        })
        .onProgressChange((event) => {
          if (event) {
            this.loadingProgress = event.newProgress;
          }
        })
        .onErrorReceive((event) => {
          if (event) {
            hilog.error(DOMAIN, TAG, `Web error: ${JSON.stringify(event)}`);
            this.errorMsg = `加载失败: ${event.error?.getErrorInfo() || '未知错误'}`;
            this.isLoading = false;
          }
        })
        .onHttpErrorReceive((event) => {
          if (event) {
            hilog.error(DOMAIN, TAG, `HTTP error: ${JSON.stringify(event)}`);
          }
        })

      // 加载指示器
      if (this.isLoading) {
        Column() {
          Progress({ value: this.loadingProgress, total: 100, type: ProgressType.Linear })
            .color('#4F46E5')
            .width('60%')
          Text('正在加载 AudioDock...')
            .fontSize(14)
            .fontColor('#999999')
            .margin({ top: 16 })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#0F0F0F')
      }

      // 错误提示
      if (this.errorMsg && !this.isLoading) {
        Column() {
          Text('⚠️')
            .fontSize(48)
          Text(this.errorMsg)
            .fontSize(14)
            .fontColor('#FF6B6B')
            .margin({ top: 12 })
          Button('重新加载')
            .margin({ top: 20 })
            .onClick(() => {
              this.errorMsg = '';
              this.isLoading = true;
              this.appController.refresh();
            })
        }
        .width('100%')
        .height('100%')
        .justifyContent(FlexAlign.Center)
        .backgroundColor('#0F0F0F')
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor('#0F0F0F')
  }
}
