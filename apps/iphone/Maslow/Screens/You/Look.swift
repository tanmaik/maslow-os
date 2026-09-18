import SwiftUI

// The colour the product spends on what a person should look at: the same
// eight the web offers, by their hue in OKLCh, and the person's pick kept
// on this device.
nonisolated enum Accent: String, CaseIterable, Identifiable, Sendable {
  case orange, red, pink, purple, blue, teal, green, graphite

  static let key = "accent"
  static let `default` = Accent.orange

  var id: String { rawValue }
  var name: String { rawValue.capitalized }

  private var oklch: (hue: Double, chroma: Double) {
    switch self {
    case .orange: (42, 0.163)
    case .red: (22, 0.17)
    case .pink: (350, 0.16)
    case .purple: (305, 0.15)
    case .blue: (255, 0.15)
    case .teal: (200, 0.11)
    case .green: (150, 0.13)
    case .graphite: (60, 0.012)
    }
  }

  var color: Color {
    let (hue, chroma) = oklch
    return Self.color(lightness: 0.66, chroma: chroma, hue: hue)
  }

  // The colour the pick named, or the orange when nothing is kept.
  static func kept(_ raw: String) -> Accent { Accent(rawValue: raw) ?? .default }

  // An OKLCh colour as sRGB, by Ottosson's own matrices, so a hue reads on
  // the phone as it reads on the web.
  private static func color(lightness: Double, chroma: Double, hue: Double) -> Color {
    let a = chroma * cos(hue * .pi / 180)
    let b = chroma * sin(hue * .pi / 180)
    let l = cubed(lightness + 0.3963377774 * a + 0.2158037573 * b)
    let m = cubed(lightness - 0.1055613458 * a - 0.0638541728 * b)
    let s = cubed(lightness - 0.0894841775 * a - 1.2914855480 * b)
    return Color(
      .sRGB,
      red: gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      green: gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      blue: gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))
  }

  private static func cubed(_ x: Double) -> Double { x * x * x }

  private static func gamma(_ x: Double) -> Double {
    let v = x <= 0.0031308 ? 12.92 * x : 1.055 * pow(x, 1 / 2.4) - 0.055
    return min(max(v, 0), 1)
  }
}

// Look: the accent, eight discs with the chosen one ringed, worn
// everywhere in the app the moment it is picked.
struct LookPane: View {
  @AppStorage(Accent.key) private var accent = Accent.default.rawValue
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    List {
      Section {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 4)], spacing: 4) {
          ForEach(Accent.allCases) { swatch($0) }
        }
        .padding(.vertical, 4)
      } header: {
        Text("Accent")
      } footer: {
        Text("Kept on this device, and worn everywhere in the app at once.")
      }
    }
    .navigationTitle("Look")
    .sensoryFeedback(.selection, trigger: accent)
  }

  private func swatch(_ one: Accent) -> some View {
    let chosen = one.rawValue == accent
    return Button {
      withAnimation(reduceMotion ? .smooth(duration: 0.2) : .snappy(duration: 0.3)) {
        accent = one.rawValue
      }
    } label: {
      Circle()
        .fill(one.color)
        .frame(width: 30, height: 30)
        .padding(7)
        .overlay {
          Circle()
            .strokeBorder(Color.primary, lineWidth: 2)
            .opacity(chosen ? 1 : 0)
            .scaleEffect(chosen ? 1 : 0.8)
        }
    }
    .buttonStyle(.plain)
    .frame(minWidth: 44, minHeight: 44)
    .accessibilityLabel(one.name)
    .accessibilityAddTraits(chosen ? .isSelected : [])
  }
}
