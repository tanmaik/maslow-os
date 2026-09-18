import SwiftUI

// Hold to talk into what is being written: the phone hears while the thumb
// is down, the words land in the text as they are heard, and the button
// breathes with the voice. Nothing of the sound leaves the device.
struct MicrophoneButton: View {
  @Binding var text: String
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var ear = Ear()
  @State private var before = ""
  @State private var mishaps = 0

  var body: some View {
    VStack(alignment: .trailing, spacing: 6) {
      Image(systemName: ear.on ? "waveform" : "mic.fill")
        .font(.title3)
        .foregroundStyle(ear.on ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
        .frame(width: 44, height: 44)
        .background(.fill.tertiary, in: .circle)
        .scaleEffect(reduceMotion ? 1 : 1 + (ear.on ? ear.level * 0.14 : 0))
        .animation(reduceMotion ? .smooth(duration: 0.2) : .snappy(duration: 0.2), value: ear.level)
        .accessibilityLabel("Hold to talk")
        .accessibilityHint("Hold to say what this should say")
        .gesture(
          DragGesture(minimumDistance: 0)
            .onChanged { _ in
              guard !ear.on else { return }
              before = text
              Task { await ear.start() }
            }
            .onEnded { _ in
              Task { land(await ear.stop()) }
            }
        )
      if let why = ear.why {
        Text(why)
          .font(.caption)
          .foregroundStyle(.secondary)
          .multilineTextAlignment(.trailing)
      }
    }
    .onChange(of: ear.heard) { if ear.on { land(ear.heard) } }
    .onChange(of: ear.why) { if ear.why != nil { mishaps += 1 } }
    .sensoryFeedback(.error, trigger: mishaps)
    .sensoryFeedback(.selection, trigger: ear.on)
    .onDisappear { ear.cancel() }
  }

  // What was heard, written after what was already there.
  private func land(_ heard: String) {
    guard !heard.isEmpty else { return }
    let had = before.trimmingCharacters(in: .whitespacesAndNewlines)
    text = had.isEmpty ? heard : "\(had)\n\(heard)"
  }
}
