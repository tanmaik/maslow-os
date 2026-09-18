import Observation
import UIKit
import UserNotifications

// How a notification reaches this phone while the app is closed: the
// token Apple's push service gives the app, handed to our server as the
// person's, and forgotten again on sign out. A banner shows even while
// the app is open, the badge is the count of asks still waiting, and a
// tap opens Waiting.
@Observable
final class Push: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
  // The location logger lives here so a launch in the background, for a
  // move the phone noticed, finds it ready with the session it kept.
  let location = Location()
  private var api: API?
  private(set) var token: String?
  // The notification just tapped, for Waiting to open on.
  var opened: String?
  // Why this phone cannot be reached, when it cannot.
  private(set) var why: String?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    UNUserNotificationCenter.current().delegate = self
    let kept = Session.restored()
    if kept.isSignedIn { location.start(kept.api) }
    return true
  }

  // Asks once, with the system's own prompt, and registers where allowed.
  func register(_ api: API) async {
    self.api = api
    let center = UNUserNotificationCenter.current()
    let allowed = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    guard allowed else {
      why = "Notifications are off for Maslow in Settings."
      return
    }
    UIApplication.shared.registerForRemoteNotifications()
  }

  func application(
    _ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
    token = hex
    Task { await keep(hex) }
  }

  func application(
    _ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error
  ) {
    why = error.localizedDescription
  }

  // Tells the server how to reach this phone, as a development build or a
  // shipped one; a server without a push key says so, once.
  private func keep(_ token: String) async {
    guard let api else { return }
    let sandbox = Self.sandbox
    struct Kept: Decodable { var kept: Bool }
    do {
      let _: Kept = try await api.put("/notifications/phone", ["token": token, "sandbox": sandbox])
      why = nil
    } catch {
      why = error.localizedDescription
    }
  }

  // Forgets this phone on the server, before the session ends.
  func forget() async {
    guard let api, let token else { return }
    try? await api.delete("/notifications/phone", ["token": token])
  }

  // Whether Apple's sandbox or its shipping service holds this token: what
  // the profile the app was signed with says, since a build installed
  // straight from Xcode is development however it was configured.
  private static var sandbox: Bool {
    guard let path = Bundle.main.path(forResource: "embedded", ofType: "mobileprovision"),
      let text = try? String(contentsOfFile: path, encoding: .isoLatin1),
      let at = text.range(of: "aps-environment")
    else { return true }
    return !text[at.upperBound...].prefix(80).contains("production")
  }

  func setBadge(_ count: Int) {
    Task { try? await UNUserNotificationCenter.current().setBadgeCount(count) }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .badge, .sound])
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let id = response.notification.request.content.userInfo["notification"] as? String ?? ""
    Task { @MainActor in self.opened = id }
    completionHandler()
  }
}
