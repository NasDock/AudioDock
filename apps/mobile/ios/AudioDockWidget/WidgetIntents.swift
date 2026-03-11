import AppIntents
import Foundation
import WidgetKit

private let widgetSuite = "group.com.soundx.mobile"
private let widgetCommandKey = "widget_command"
private let widgetCommandTimestampKey = "widget_command_ts"
private let widgetCommandNotification = "com.soundx.widget.command"
private let widgetKind = "AudioDockWidget"
private let widgetPlayModeOverrideKey = "widget_play_mode_override"
private let widgetPlayModeOverrideUntilKey = "widget_play_mode_override_until"
private let widgetPlayModeNextKey = "widget_play_mode_next"

@available(iOS 17.0, *)
enum WidgetAction: String, AppEnum {
  case play
  case pause
  case next
  case prev
  case mode
  case like
  case unlike

  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Widget Action"

  static var caseDisplayRepresentations: [WidgetAction: DisplayRepresentation] = [
    .play: "Play",
    .pause: "Pause",
    .next: "Next",
    .prev: "Previous",
    .mode: "Play Mode",
    .like: "Like",
    .unlike: "Unlike",
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
    applyOptimisticStateUpdate(action: action, defaults: defaults)
    defaults.synchronize()
    WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
    WidgetCenter.shared.reloadAllTimelines()

    let center = CFNotificationCenterGetDarwinNotifyCenter()
    CFNotificationCenterPostNotification(center,
                                         CFNotificationName(widgetCommandNotification as CFString),
                                         nil,
                                         nil,
                                         true)
  }

  private static func applyOptimisticStateUpdate(action: String, defaults: UserDefaults) {
    switch action {
    case "play":
      defaults.set(true, forKey: "widget_is_playing")
    case "pause":
      defaults.set(false, forKey: "widget_is_playing")
    case "mode":
      let current = resolveCurrentPlayMode(defaults: defaults)
      let next = nextPlayMode(from: current)
      defaults.set(next, forKey: "widget_play_mode")
      defaults.set(next, forKey: widgetPlayModeOverrideKey)
      defaults.set(Date().timeIntervalSince1970 + 2.0, forKey: widgetPlayModeOverrideUntilKey)
      defaults.set(next, forKey: widgetPlayModeNextKey)
    case "like":
      defaults.set(true, forKey: "widget_is_liked")
    case "unlike":
      defaults.set(false, forKey: "widget_is_liked")
    default:
      break
    }
  }

  private static func nextPlayMode(from current: String) -> String {
    let normalized = normalizePlayMode(current)
    let modes = ["SEQUENCE", "SHUFFLE", "LOOP_LIST", "LOOP_SINGLE"]
    guard let index = modes.firstIndex(of: normalized) else {
      return modes[0]
    }
    return modes[(index + 1) % modes.count]
  }

  private static func resolveCurrentPlayMode(defaults: UserDefaults) -> String {
    let overrideUntil = defaults.double(forKey: widgetPlayModeOverrideUntilKey)
    if overrideUntil > Date().timeIntervalSince1970,
       let override = defaults.string(forKey: widgetPlayModeOverrideKey),
       !override.isEmpty {
      return override
    }
    return defaults.string(forKey: "widget_play_mode") ?? ""
  }

  private static func normalizePlayMode(_ raw: String) -> String {
    switch raw.uppercased() {
    case "SHUFFLE", "RANDOM":
      return "SHUFFLE"
    case "LOOP_SINGLE", "SINGLE_LOOP", "SINGLE":
      return "LOOP_SINGLE"
    case "LOOP_LIST", "LIST_LOOP", "LOOP":
      return "LOOP_LIST"
    case "SEQUENCE", "ORDER", "DEFAULT":
      return "SEQUENCE"
    default:
      return raw
    }
  }
}
