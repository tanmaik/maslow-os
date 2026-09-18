import SwiftUI

// Hold to talk: the one control the Agent is held by. The thumb presses
// and the phone listens, the button breathes with the voice and the words
// appear as they are heard; the thumb lifts and they go. Slide off the
// button before lifting and nothing is sent.

// A hold shorter than this is a tap, which says how the button works
// rather than sending a word.
private let tap = Duration.milliseconds(350)
// How far past the button's edge the thumb may wander before letting go
// means cancel.
private let slack: CGFloat = 28

struct HoldToTalk: View {
  let ear: Ear
  // Why nothing can be said right now, when nothing can.
  let note: String?
  let onHold: () -> Void
  let onRelease: () -> Void
  let onCancel: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var holding = false
  @State private var leaving = false
  @State private var hint = false
  @State private var since = ContinuousClock.now
  @State private var size = CGSize.zero
  @ScaledMetric(relativeTo: .title3) private var height = 72.0

  var body: some View {
    ZStack {
      Capsule()
        .fill(.clear)
        .glassEffect(.regular.tint(Color.accentColor).interactive(), in: .capsule)
        .opacity(note != nil ? 0.5 : 1)
      if holding && !reduceMotion {
        // The voice as a ring that swells with it: one stroke, nothing blurred.
        Capsule()
          .strokeBorder(.white.opacity(0.25 + ear.level * 0.5), lineWidth: 2)
          .scaleEffect(x: 1 + ear.level * 0.04, y: 1 + ear.level * 0.12)
      }
      words
        .foregroundStyle(.white)
        .padding(.horizontal, 18)
    }
    .frame(height: height)
    .frame(maxWidth: .infinity)
    .contentShape(.capsule)
    .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
    .gesture(
      DragGesture(minimumDistance: 0)
        .onChanged { touch in
          if !holding { press() }
          leaving = holding && away(touch.location)
        }
        .onEnded { touch in lift(cancelled: away(touch.location)) }
    )
    .animation(reduceMotion ? nil : .smooth(duration: 0.12), value: ear.level)
    .animation(reduceMotion ? .smooth(duration: 0.2) : .snappy(duration: 0.25), value: holding)
    .animation(.snappy(duration: 0.2), value: leaving)
    .sensoryFeedback(trigger: holding) { _, now in
      .impact(weight: now ? .medium : .light)
    }
    .sensoryFeedback(.error, trigger: ear.why)
    .accessibilityElement()
    .accessibilityLabel("Hold to talk")
    .accessibilityHint("Hold to speak to your agent, then let go to send.")
    .accessibilityAddTraits(.isButton)
  }

  @ViewBuilder private var words: some View {
    if let note {
      Text(note)
        .font(.subheadline)
        .multilineTextAlignment(.center)
    } else if leaving {
      Text("Release to cancel").font(.title3.weight(.medium))
    } else if holding {
      HStack(spacing: 10) {
        Level(level: ear.level)
        Text("Listening").font(.title3.weight(.medium))
      }
    } else if hint {
      Text("Hold, talk, let go").font(.title3.weight(.medium))
    } else {
      Label("Hold to talk", systemImage: "mic.fill")
        .font(.title3.weight(.medium))
    }
  }

  private func press() {
    guard note == nil else { return }
    since = .now
    hint = false
    leaving = false
    holding = true
    onHold()
  }

  private func lift(cancelled: Bool) {
    guard holding else { return }
    holding = false
    let quick = since.duration(to: .now) < tap
    leaving = false
    if cancelled || quick {
      hint = quick
      return onCancel()
    }
    onRelease()
  }

  private func away(_ point: CGPoint) -> Bool {
    point.x < -slack || point.y < -slack
      || point.x > size.width + slack || point.y > size.height + slack
  }
}

// The voice as it is heard, four bars that rise with it.
private struct Level: View {
  let level: Double

  var body: some View {
    HStack(alignment: .bottom, spacing: 3) {
      ForEach([0.5, 1.0, 0.7, 0.9], id: \.self) { share in
        Capsule()
          .fill(.white.opacity(0.9))
          .frame(width: 3, height: 6 + share * (4 + level * 16))
      }
    }
    .frame(height: 26, alignment: .center)
    .accessibilityHidden(true)
  }
}
