import AppIntents
import Foundation

private let widgetSuite = "group.com.soundx.mobile"
private let widgetCommandKey = "widget_command"
private let widgetCommandTimestampKey = "widget_command_ts"
private let widgetCommandNotification = "com.soundx.widget.command"

@available(iOS 17.0, *)
enum WidgetAction: String, AppEnum {
  case play
  case pause
  case next
  case prev

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Widget Action"

  static var caseDisplayRepresentations: [WidgetAction: DisplayRepresentation] = [
    .play: "Play",
    .pause: "Pause",
    .next: "Next",
    .prev: "Previous",
  ]
}

@available(iOS 17.0, *)
struct WidgetControlIntent: AppIntent {
  static var title: LocalizedStringResource = "Widget Control"
  static var description = IntentDescription("Control playback from the widget")

  @Parameter(title: "Action")
  var action: WidgetAction

  init() {}

  init(action: WidgetAction) {
    self.action = action
  }

  func perform() async throws -> some IntentResult {
    WidgetCommandCenter.send(action: action.rawValue)
    return .result()
  }
}

@available(iOS 17.0, *)
enum WidgetCommandCenter {
  static func send(action: String) {
    guard let defaults = UserDefaults(suiteName: widgetSuite) else { return }
    defaults.set(action, forKey: widgetCommandKey)
    defaults.set(Date().timeIntervalSince1970, forKey: widgetCommandTimestampKey)

    let center = CFNotificationCenterGetDarwinNotifyCenter()
    CFNotificationCenterPostNotification(center,
                                         CFNotificationName(widgetCommandNotification as CFString),
                                         nil,
                                         nil,
                                         true)
  }
}
