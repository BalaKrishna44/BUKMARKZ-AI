import BackgroundTasks
import Photos

/// Setup:
///  - Xcode > Signing & Capabilities > Background Modes: "Background processing"
///  - Info.plist: BGTaskSchedulerPermittedIdentifiers = ["com.bukmarkz.photosync"]
///  - Info.plist: NSPhotoLibraryUsageDescription (read + delete)
///  - AppDelegate.didFinishLaunching: BackgroundSync.register()   (must run before launch finishes)
enum BackgroundSync {
  static let id = "com.bukmarkz.photosync"
  static weak var emitter: PhotoLibraryModule?
  private static var current: BGProcessingTask?

  static func register() {
    BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in
      guard let task = task as? BGProcessingTask else { return }
      handle(task)
    }
  }

  static func schedule() {
    let r = BGProcessingTaskRequest(identifier: id)
    r.requiresNetworkConnectivity = true
    r.requiresExternalPower = false          // set true to only sync while charging
    r.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    try? BGTaskScheduler.shared.submit(r)    // iOS decides when (typically overnight, charging, on Wi-Fi)
  }

  private static func handle(_ task: BGProcessingTask) {
    schedule()                               // always queue the next run first
    current = task
    task.expirationHandler = {
      emitter?.sendEvent(withName: "BackgroundSyncExpiring", body: nil)
      task.setTaskCompleted(success: false)  // pending queue is persisted, so nothing is lost
      current = nil
    }
    enqueueAssets(since: PendingQueue.watermark)
    // The RN bridge/JS runtime is created by the normal app launch the OS performs for this task.
    emitter?.sendEvent(withName: "BackgroundSyncStarted", body: nil)
  }

  static func complete(success: Bool) { current?.setTaskCompleted(success: success); current = nil }

  /// Catch-up scan: everything created after the watermark. Returns how many were enqueued.
  @discardableResult
  static func enqueueAssets(since: Date) -> Int {
    guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized
       || PHPhotoLibrary.authorizationStatus(for: .readWrite) == .limited else { return 0 }
    let o = PHFetchOptions()
    o.predicate = NSPredicate(format: "creationDate > %@ AND (mediaType == %d OR mediaType == %d)", since as NSDate,
                              PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
    let res = PHAsset.fetchAssets(with: o)
    var ids: [String] = []; var newest = since
    res.enumerateObjects { a, _, _ in ids.append(a.localIdentifier); if let d = a.creationDate, d > newest { newest = d } }
    PendingQueue.add(ids)
    if newest > PendingQueue.watermark { PendingQueue.watermark = newest }
    return ids.count
  }
}
