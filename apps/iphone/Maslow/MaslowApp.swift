import SwiftUI

// The phone: the lock screen until a session is held, then the home tabs.
@main
struct MaslowApp: App {
  @State private var session = Session.restored()
  @UIApplicationDelegateAdaptor(Push.self) private var push

  var body: some Scene {
    WindowGroup {
      Root()
        .environment(session)
        .environment(push)
    }
  }
}

// The one look, dark, over everything: lock to home, home grows in as the
// lock screen falls away, and both simply fade for anyone who asked for less
// motion.
struct Root: View {
  @Environment(Session.self) private var session
  @Environment(Push.self) private var push
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  // The colour the person picked under Look, kept on this device.
  @AppStorage(Accent.key) private var accent = Accent.default.rawValue

  var body: some View {
    ZStack {
      if session.isSignedIn {
        HomeView().transition(arrive(from: 1.04))
      } else {
        LockScreen().transition(arrive(from: 0.98))
      }
    }
    .animation(.smooth(duration: reduceMotion ? 0.25 : 0.45), value: session.isSignedIn)
    .tint(Accent.kept(accent).color)
    .task(id: session.held?.token) {
      if session.isSignedIn {
        push.location.start(session.api)
        await push.register(session.api)
      } else {
        push.location.stop()
      }
    }
    .preferredColorScheme(.dark)
  }

  private func arrive(from scale: CGFloat) -> AnyTransition {
    reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: scale))
  }
}
