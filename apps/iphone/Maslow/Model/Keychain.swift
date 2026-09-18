import Foundation
import Security

// The one thing kept on the device between launches: the session, in the
// keychain, so it survives a reinstall of nothing and a restart of anything.
nonisolated enum Keychain {
  private static let service = "tech.maslow.iphone"

  // A keychain call that did not land, in the device's own words.
  nonisolated struct Failure: LocalizedError {
    let status: OSStatus
    var errorDescription: String? {
      let said = (SecCopyErrorMessageString(status, nil) as String?) ?? "error \(status)"
      return "This device would not keep the session: \(said)"
    }
  }

  static func read(_ key: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
    return out as? Data
  }

  static func write(_ key: String, _ data: Data) -> Failure? {
    if let failure = delete(key) { return failure }
    let item: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
      kSecValueData as String: data,
    ]
    let status = SecItemAdd(item as CFDictionary, nil)
    return status == errSecSuccess ? nil : Failure(status: status)
  }

  static func delete(_ key: String) -> Failure? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
    ]
    let status = SecItemDelete(query as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
      ? nil : Failure(status: status)
  }
}
