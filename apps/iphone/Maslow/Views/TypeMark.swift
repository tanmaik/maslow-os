import SwiftUI
import UIKit

// A type's colour, from a hash of its name so adding a type never recolours
// the others, in a light, dark and increased-contrast variant.
extension Color {
  nonisolated static func forType(_ name: String) -> Color {
    var h = 0
    for c in name.unicodeScalars { h = (h * 31 + Int(c.value)) % 360 }
    let hue = Double(h) / 360
    return Color(
      uiColor: UIColor { traits in
        let dark = traits.userInterfaceStyle == .dark
        let firmer = traits.accessibilityContrast == .high
        return UIColor(
          hue: hue,
          saturation: firmer ? 0.9 : 0.6,
          brightness: dark ? (firmer ? 0.95 : 0.82) : (firmer ? 0.52 : 0.64),
          alpha: 1)
      })
  }
}

// A type's mark: a small square in its colour, scaled with the body text.
struct TypeDot: View {
  let type: String
  @ScaledMetric(relativeTo: .body) private var side = 8.0

  var body: some View {
    RoundedRectangle(cornerRadius: side / 4, style: .continuous)
      .fill(Color.forType(type))
      .frame(width: side, height: side)
      .accessibilityHidden(true)
  }
}

// A type named beside its mark.
struct TypeMark: View {
  let type: String
  var body: some View {
    HStack(spacing: 6) {
      TypeDot(type: type)
      Text(type)
    }
  }
}
