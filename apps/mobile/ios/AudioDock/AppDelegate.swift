import Expo
import React
import ReactAppDependencyProvider
import Foundation

private let widgetSuiteName = "group.com.audiodock.app"
private let widgetCommandKey = "widget_command"
private let widgetCommandNotification = "com.soundx.widget.command" as CFString
private let widgetCommandPayloadKey = "widget_command_payload"

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
    WidgetCommandObserver.shared.start()

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}

private final class WidgetCommandObserver {
  static let shared = WidgetCommandObserver()
  private var isStarted = false

  func start() {
    guard !isStarted else { return }
    isStarted = true
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(),
      Unmanaged.passUnretained(self).toOpaque(),
      widgetCommandCallback,
      widgetCommandNotification,
      nil,
      .deliverImmediately
    )
  }

  func handle() {
    guard let defaults = UserDefaults(suiteName: widgetSuiteName) else { return }
    defaults.synchronize()
    guard let command = defaults.string(forKey: widgetCommandKey), !command.isEmpty else { return }
    let playMode = defaults.string(forKey: "widget_play_mode") ?? ""
    let nextPlayMode = defaults.string(forKey: "widget_play_mode_next") ?? ""
    let isLiked = defaults.bool(forKey: "widget_is_liked")
    var payload: [String: Any] = [
      "playMode": playMode,
      "nextPlayMode": nextPlayMode,
      "isLiked": isLiked
    ]
    if let data = defaults.data(forKey: widgetCommandPayloadKey),
       let extra = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      payload.merge(extra) { _, new in new }
    }
    WidgetCommandEmitter.sendCommand(command, payload: payload)
  }
}

private func widgetCommandCallback(
  center: CFNotificationCenter?,
  observer: UnsafeMutableRawPointer?,
  name: CFNotificationName?,
  object: UnsafeRawPointer?,
  userInfo: CFDictionary?
) {
  guard let observer = observer else { return }
  let instance = Unmanaged<WidgetCommandObserver>.fromOpaque(observer).takeUnretainedValue()
  instance.handle()
}
