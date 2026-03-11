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
}

struct AudioDockProvider: TimelineProvider {
  func placeholder(in context: Context) -> AudioDockEntry {
    AudioDockEntry(
      date: Date(),
      title: "AudioDock",
      artist: "正在播放",
      isPlaying: false,
      cover: nil
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
      cover: coverImage
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
    .padding(12)
    .background(Color.black)
    .foregroundColor(.white)
    .modifier(WidgetBackground())
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
    .cornerRadius(10)
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
    HStack(spacing: 16) {
      controlButton(systemName: "backward.fill", action: "prev")
      controlButton(systemName: entry.isPlaying ? "pause.fill" : "play.fill", action: entry.isPlaying ? "pause" : "play")
      controlButton(systemName: "forward.fill", action: "next")
    }
  }

  private var largeView: some View {
    VStack(alignment: .leading, spacing: 8) {
      coverView
        .frame(maxWidth: .infinity, maxHeight: 160)
      titleView
      artistView
      Spacer(minLength: 4)
      controlsView
    }
  }

  private var mediumView: some View {
    HStack(spacing: 12) {
      coverView
        .frame(width: 64, height: 64)
      VStack(alignment: .leading, spacing: 6) {
        titleView
        artistView
        Spacer(minLength: 4)
        controlsView
      }
    }
  }

  private var smallView: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        coverView
          .frame(width: 42, height: 42)
        VStack(alignment: .leading, spacing: 4) {
          titleView
          artistView
        }
      }
      controlsView
    }
  }

  private func controlButton(systemName: String, action: String) -> some View {
    let url = URL(string: "audiodock://widget?action=\(action)")
    return Link(destination: url!) {
      Image(systemName: systemName)
        .font(.system(size: 16, weight: .semibold))
        .frame(width: 24, height: 24)
    }
  }
}

struct WidgetBackground: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 17.0, *) {
      content.containerBackground(Color.black, for: .widget)
    } else {
      content
    }
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
