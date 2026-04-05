import WidgetKit
import SwiftUI
import AppIntents

private let widgetKind = "AudioDockWidget"
private let widgetSuite = "group.com.audiodock.app"
private let coverFileKey = "widget_cover_file"
private let playModeOverrideKey = "widget_play_mode_override"
private let playModeOverrideUntilKey = "widget_play_mode_override_until"

struct AudioDockEntry: TimelineEntry {
  let date: Date
  let title: String
  let artist: String
  let isPlaying: Bool
  let cover: UIImage?
  let playMode: String
  let isLiked: Bool
  let isVip: Bool
  let colorPrimary: Color
  let colorSecondary: Color
}

struct AudioDockProvider: TimelineProvider {
  func placeholder(in context: Context) -> AudioDockEntry {
    AudioDockEntry(
      date: Date(),
      title: "AudioDock",
      artist: "正在播放",
      isPlaying: false,
      cover: nil,
      playMode: "",
      isLiked: false,
      isVip: true, // Placeholder is usually Fine to show
      colorPrimary: Color.black,
      colorSecondary: Color.black
    )
  }

  func getSnapshot(in context: Context, completion: @escaping (AudioDockEntry) -> Void) {
    completion(loadEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<AudioDockEntry>) -> Void) {
    let entry = loadEntry()
    let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date().addingTimeInterval(900)
    completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
  }

  private func loadEntry() -> AudioDockEntry {
    let defaults = UserDefaults(suiteName: widgetSuite)
    let title = defaults?.string(forKey: "widget_title") ?? "未在播放"
    let artist = defaults?.string(forKey: "widget_artist") ?? ""
    let isPlaying = defaults?.bool(forKey: "widget_is_playing") ?? false
    let playMode = resolvePlayMode(defaults: defaults) ?? ""
    let isLiked = defaults?.bool(forKey: "widget_is_liked") ?? false
    let isVip = defaults?.bool(forKey: "widget_is_vip") ?? false
    print("[AudioDockWidget] loadEntry isVip=\(isVip) suiteAvailable=\(defaults != nil)")
    let primaryHex = defaults?.string(forKey: "widget_color_primary") ?? "#000000"
    let secondaryHex = defaults?.string(forKey: "widget_color_secondary") ?? "#000000"

    var coverImage: UIImage? = nil
    if let coverName = defaults?.string(forKey: coverFileKey),
       let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: widgetSuite) {
      let coverURL = containerURL.appendingPathComponent(coverName)
      if let data = try? Data(contentsOf: coverURL) {
        coverImage = UIImage(data: data)
      }
    }

    return AudioDockEntry(
      date: Date(),
      title: title,
      artist: artist,
      isPlaying: isPlaying,
      cover: coverImage,
      playMode: playMode,
      isLiked: isLiked,
      isVip: isVip,
      colorPrimary: Color(hex: primaryHex),
      colorSecondary: Color(hex: secondaryHex)
    )
  }

  private func resolvePlayMode(defaults: UserDefaults?) -> String? {
    guard let defaults else { return nil }
    let overrideUntil = defaults.double(forKey: playModeOverrideUntilKey)
    if overrideUntil > Date().timeIntervalSince1970 {
      return defaults.string(forKey: playModeOverrideKey)
    }
    return defaults.string(forKey: "widget_play_mode")
  }
}

struct AudioDockWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  let entry: AudioDockEntry

  var body: some View {
    Group {
      if entry.isVip {
        switch family {
        case .systemLarge:
            largeView
        case .systemMedium:
            mediumView
        default:
            smallView
        }
      } else {
        lockedView
      }
    }
    .foregroundColor(.white)
    .modifier(WidgetBackground(primary: entry.colorPrimary, secondary: entry.colorSecondary, cover: entry.isVip ? entry.cover : nil))
    .widgetURL(URL(string: "audiodock://member-benefits"))
  }

  private var coverView: some View {
    Group {
      if let image = entry.cover {
        Image(uiImage: image)
          .resizable()
          .scaledToFill()
      } else {
        ZStack {
          Color.white.opacity(0.08)
          Image(systemName: "music.note")
            .font(.system(size: 20, weight: .semibold))
            .foregroundColor(.white.opacity(0.8))
        }
      }
    }
    .clipped()
  }

  private var titleView: some View {
    Text(entry.title)
      .font(.system(size: 14, weight: .semibold))
      .lineLimit(1)
  }

  private var artistView: some View {
    Text(entry.artist)
      .font(.system(size: 12))
      .foregroundColor(.white.opacity(0.7))
      .lineLimit(1)
  }

  private var controlsView: some View {
    HStack(spacing: 18) {
      controlButton(systemName: "backward.end.fill", action: "prev")
      controlButton(systemName: entry.isPlaying ? "pause.fill" : "play.fill", action: entry.isPlaying ? "pause" : "play")
      controlButton(systemName: "forward.end.fill", action: "next")
    }
  }

  private var largeControlsView: some View {
    HStack(spacing: 16) {
      controlButton(systemName: modeIconName, action: "mode")
      controlButton(systemName: "backward.end.fill", action: "prev")
      controlButton(systemName: entry.isPlaying ? "pause.fill" : "play.fill", action: entry.isPlaying ? "pause" : "play")
      controlButton(systemName: "forward.end.fill", action: "next")
      controlButton(systemName: entry.isLiked ? "heart.fill" : "heart", action: entry.isLiked ? "unlike" : "like")
    }
  }

  private var largeView: some View {
    VStack(spacing: 8) {
      coverView
        .frame(width: 198, height: 198)
        .cornerRadius(14)
      titleView
        .frame(maxWidth: .infinity, alignment: .center)
      artistView
        .frame(maxWidth: .infinity, alignment: .center)
      largeControlsView
    }
    .padding(14)
  }

  private var mediumView: some View {
    HStack(spacing: 8) {
      ZStack(alignment: .leading) {
        Color.black.opacity(0.01)
        coverView
          .frame(width: 104, height: 104)
          .cornerRadius(12)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)

      VStack(spacing: 6) {
        titleView
          .frame(maxWidth: .infinity, alignment: .center)
        artistView
          .frame(maxWidth: .infinity, alignment: .center)
        controlsView
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .padding(12)
  }

  private var smallView: some View {
    VStack(spacing: 8) {
      coverView
        .frame(width: 72, height: 72)
        .cornerRadius(12)
        .padding(.top, 8)
      titleView
        .frame(maxWidth: .infinity, alignment: .center)
      controlsView
    }
    .padding(10)
  }

  private var lockedView: some View {
    VStack(spacing: 12) {
      Image(systemName: "crown.fill")
        .font(.system(size: 24))
        .foregroundColor(.yellow)
      Text("会员专属功能")
        .font(.system(size: 14, weight: .bold))
      Text("请在 App 中开通会员")
        .font(.system(size: 11))
        .opacity(0.7)
    }
    .padding()
    .multilineTextAlignment(.center)
  }

  private var modeIconName: String {
    switch entry.playMode.uppercased() {
    case "SHUFFLE", "RANDOM":
      return "shuffle"
    case "LOOP_SINGLE", "SINGLE_LOOP", "SINGLE":
      return "repeat.1"
    case "LOOP_LIST", "LIST_LOOP", "LOOP":
      return "repeat"
    case "SEQUENCE", "ORDER", "DEFAULT":
      return "list.bullet"
    default:
      return "repeat"
    }
  }

  @ViewBuilder
  private func controlButton(systemName: String, action: String) -> some View {
    if #available(iOS 17.0, *) {
      let widgetAction = WidgetAction(rawValue: action) ?? .play
      Button(intent: WidgetControlIntent(action: widgetAction)) {
        Image(systemName: systemName)
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 24, height: 24)
      }
      .buttonStyle(.plain)
    } else {
      let url = URL(string: "audiodock://?action=\(action)")
      Link(destination: url!) {
        Image(systemName: systemName)
          .font(.system(size: 16, weight: .semibold))
          .frame(width: 24, height: 24)
      }
    }
  }
}

struct WidgetBackground: ViewModifier {
  let primary: Color
  let secondary: Color
  let cover: UIImage?

  @ViewBuilder
  private var glassBackground: some View {
    if let cover {
      Image(uiImage: cover)
        .resizable()
        .scaledToFill()
        .blur(radius: 18)
        .overlay(Color.white.opacity(0.08))
        .overlay(Color.black.opacity(0.22))
    } else {
      LinearGradient(
        gradient: Gradient(colors: [primary.opacity(0.9), secondary.opacity(0.9)]),
        startPoint: .topLeading,
        endPoint: .bottomTrailing
      )
    }
  }

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content.containerBackground(for: .widget) {
        glassBackground
      }
    } else {
      content.background(
        glassBackground
      )
    }
  }
}

extension Color {
  init(hex: String) {
    let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var int: UInt64 = 0
    Scanner(string: hex).scanHexInt64(&int)
    let r = Double((int >> 16) & 0xFF) / 255.0
    let g = Double((int >> 8) & 0xFF) / 255.0
    let b = Double(int & 0xFF) / 255.0
    self.init(red: r, green: g, blue: b)
  }
}

struct AudioDockWidget: Widget {
  let kind: String = widgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: AudioDockProvider()) { entry in
      AudioDockWidgetEntryView(entry: entry)
    }
    .configurationDisplayName("AudioDock")
    .description("展示当前播放并支持控制")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}
