import CoreLocation
import Foundation
import Observation

// The person's location, logged to their own machine for as long as they
// carry the phone: a fix every minute while the app is open and, with
// Always, a fix whenever they move a short way with it closed, the phone
// waking the app after a longer move if it was ever stopped. Each fix goes
// straight to the door of their computer with a ticket our server mints,
// never through us or into our database. Off until they allow it; never
// asked again once refused.
@Observable
final class Location: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var api: API?
  private var target: (door: URL, ticket: String, until: Date)?
  private var ticking: Task<Void, Never>?

  private static let every: Duration = .seconds(60)
  private static let ticketFor: TimeInterval = 55 * 60

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    manager.distanceFilter = 25
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.showsBackgroundLocationIndicator = true
  }

  // Starts logging as this person: asks once if never asked, and with
  // Always keeps going in the background from here on.
  func start(_ api: API) {
    self.api = api
    // A new session is a new machine to reach: the last door is forgotten.
    target = nil
    if manager.authorizationStatus == .notDetermined {
      manager.requestAlwaysAuthorization()
    }
    background()
  }

  // The minute tick, while the app is in front and looked at.
  func foreground(_ on: Bool) {
    ticking?.cancel()
    ticking = nil
    guard on, api != nil else { return }
    ticking = Task {
      while !Task.isCancelled {
        readIfAllowed()
        try? await Task.sleep(for: Self.every)
      }
    }
  }

  // Signed out: nothing is read and nothing is sent.
  func stop() {
    ticking?.cancel()
    ticking = nil
    api = nil
    manager.stopUpdatingLocation()
    manager.stopMonitoringSignificantLocationChanges()
    manager.stopMonitoringVisits()
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let last = locations.last else { return }
    let line = ["latitude": last.coordinate.latitude, "longitude": last.coordinate.longitude,
                "accuracy": last.horizontalAccuracy.rounded()]
    Task { @MainActor in await self.report(line) }
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {}

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    Task { @MainActor in self.readIfAllowed() }
  }

  private func readIfAllowed() {
    if [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) {
      manager.requestLocation()
    }
    background()
  }

  // With Always, every short move is a fix, day and night; a longer move
  // wakes the app to carry on if it was ever stopped.
  private func background() {
    guard manager.authorizationStatus == .authorizedAlways else { return }
    manager.startUpdatingLocation()
    manager.startMonitoringSignificantLocationChanges()
    manager.startMonitoringVisits()
  }

  nonisolated func locationManager(_ manager: CLLocationManager, didVisit visit: CLVisit) {
    let line = ["latitude": visit.coordinate.latitude, "longitude": visit.coordinate.longitude,
                "accuracy": visit.horizontalAccuracy.rounded()]
    Task { @MainActor in await self.report(line) }
  }

  // One line to the machine, on a ticket minted fresh once the last has
  // run most of its hour. Nothing where there is no ready computer.
  private func report(_ line: [String: Double]) async {
    guard let api else { return }
    if target == nil || target!.until < .now {
      struct Target: Decodable { var door: String; var ticket: String }
      guard let t: Target = try? await api.post("/computer/location", [:]), let door = URL(string: t.door)
      else { return }
      target = (door, t.ticket, .now.addingTimeInterval(Self.ticketFor))
    }
    guard let target else { return }
    var request = URLRequest(url: target.door)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.setValue(target.ticket, forHTTPHeaderField: "x-maslow-ticket")
    request.httpBody = try? JSONSerialization.data(withJSONObject: line)
    _ = try? await URLSession.shared.data(for: request)
  }
}
