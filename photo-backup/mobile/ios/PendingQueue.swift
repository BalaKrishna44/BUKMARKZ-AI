import Foundation

/// Tiny persisted FIFO of asset identifiers, shared by the observer, the BG task and the JS bridge.
enum PendingQueue {
  private static let key = "bkz.pendingAssetIds"
  private static let lock = NSLock()
  private static var defaults: UserDefaults { .standard }

  static func add(_ ids: [String]) {
    lock.lock(); defer { lock.unlock() }
    var cur = defaults.stringArray(forKey: key) ?? []
    let have = Set(cur)
    cur.append(contentsOf: ids.filter { !have.contains($0) })
    defaults.set(cur, forKey: key)
  }
  static func all() -> [String] { lock.lock(); defer { lock.unlock() }; return defaults.stringArray(forKey: key) ?? [] }
  static func remove(_ ids: [String]) {
    lock.lock(); defer { lock.unlock() }
    let drop = Set(ids)
    defaults.set((defaults.stringArray(forKey: key) ?? []).filter { !drop.contains($0) }, forKey: key)
  }

  // Watermark: creationDate of the newest asset we have already enqueued.
  static var watermark: Date {
    get { Date(timeIntervalSince1970: defaults.double(forKey: "bkz.watermark")) }
    set { defaults.set(newValue.timeIntervalSince1970, forKey: "bkz.watermark") }
  }
}
