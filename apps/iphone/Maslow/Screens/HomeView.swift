import SwiftUI
import UserNotifications

// Home: the brain, the computer, what waits on you, and you.
struct HomeView: View {
  @Environment(Session.self) private var session
  @Environment(Push.self) private var push
  @Environment(\.scenePhase) private var phase
  @State private var waiting = 0
  @State private var tab = "brain"

  var body: some View {
    TabView(selection: $tab) {
      Tab("Brain", systemImage: "brain.fill", value: "brain") {
        BrainView()
      }
      Tab("Computer", systemImage: "desktopcomputer", value: "computer") {
        ComputerView()
      }
      Tab("Waiting", systemImage: "bell.fill", value: "waiting") {
        NotificationsView(waiting: $waiting)
      }
      .badge(waiting)
      Tab("You", systemImage: "person.crop.circle.fill", value: "you") {
        YouView()
      }
    }
    .tabBarMinimizeBehavior(.onScrollDown)
    .onChange(of: push.opened) { _, id in
      if id != nil { tab = "waiting" }
    }
    .onChange(of: waiting) { _, n in push.setBadge(n) }
    .onChange(of: phase, initial: true) { _, now in
      push.location.foreground(now == .active)
    }
    .task {
      // The count of asks waiting on you, kept current while the app is up.
      while !Task.isCancelled {
        if let n = try? await session.api.waiting() { waiting = n.waiting }
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }
}
