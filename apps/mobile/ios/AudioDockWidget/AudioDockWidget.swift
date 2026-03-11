import WidgetKit
import SwiftUI

private let widgetKind = "AudioDockWidget"
private let widgetSuite = "group.com.soundx.mobile"
private let coverFileKey = "widget_cover_file"

struct AudioDockEntry: TimelineEntry {
  let date: Date
  let title: String
  let artist: String
  let isPlaying: Bool
  let cover: UIImage?
  let lyric: String
  let progress: Double
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
      lyric: "",
      progress: 0,
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
    let lyric = defaults?.string(forKey: "widget_lyric") ?? ""
    let progress = defaults?.double(forKey: "widget_progress") ?? 0
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
      lyric: lyric,
      progress: progress,
      colorPrimary: Color(hex: primaryHex),
      colorSecondary: Color(hex: secondaryHex)
    )
  }
}

struct AudioDockWidgetEntryView: View {
  @Environment(\.widgetFamily) var family
  let entry: AudioDockEntry

  var body: some View {
    Group {
      switch family {
      case .systemLarge:
        largeView
      case .systemMedium:
        mediumView
      default:
        smallView
      }
    }
    .foregroundColor(.white)
    .modifier(WidgetBackground(primary: entry.colorPrimary, secondary: entry.colorSecondary))
    .widgetURL(URL(string: "audiodock://widget?open=player"))
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
      controlButton(systemName: "backward.fill", action: "prev")
      controlButton(systemName: entry.isPlaying ? "pause.fill" : "play.fill", action: entry.isPlaying ? "pause" : "play")
      controlButton(systemName: "forward.fill", action: "next")
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
      lyricView
        .frame(maxWidth: .infinity, alignment: .center)
      controlsView
      progressView
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

  private var lyricView: some View {
    Text(entry.lyric)
      .font(.system(size: 11, weight: .medium))
      .foregroundColor(.white.opacity(0.8))
      .lineLimit(1)
  }

  private var progressView: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      let progressWidth = max(0, min(width, width * entry.progress))
      ZStack(alignment: .leading) {
        Capsule()
          .fill(Color.white.opacity(0.2))
          .frame(height: 4)
        Capsule()
          .fill(Color.white.opacity(0.85))
          .frame(width: progressWidth, height: 4)
      }
    }
    .frame(height: 6)
    .padding(.top, 4)
  }

  private func controlButton(systemName: String, action: String) -> some View {
    let url = URL(string: "audiodock://widget?action=\(action)&open=player")
    return Link(destination: url!) {
      Image(systemName: systemName)
        .font(.system(size: 16, weight: .semibold))
        .frame(width: 24, height: 24)
    }
  }
}

struct WidgetBackground: ViewModifier {
  let primary: Color
  let secondary: Color

  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content.containerBackground(
        LinearGradient(
          gradient: Gradient(colors: [primary.opacity(0.9), secondary.opacity(0.9)]),
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        ),
        for: .widget
      )
    } else {
      content.background(
        LinearGradient(
          gradient: Gradient(colors: [primary.opacity(0.9), secondary.opacity(0.9)]),
          startPoint: .topLeading,
          endPoint: .bottomTrailing
        )
      )
    }
  }
}

private extension Color {
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
