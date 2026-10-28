import Photos

/// Live observer. iOS only delivers these callbacks while the process is running (foreground, or briefly
/// after a background launch). It does NOT wake a terminated app for a new photo; that gap is covered by
/// the BGProcessingTask catch-up scan in BackgroundSync.swift, which diffs the library against a watermark.
final class PhotoLibraryWatcher: NSObject, PHPhotoLibraryChangeObserver {
  static let shared = PhotoLibraryWatcher()
  private var recent: PHFetchResult<PHAsset>?
  var onNewAssets: (([String]) -> Void)?

  private static func recentFetch() -> PHFetchResult<PHAsset> {
    let o = PHFetchOptions()
    o.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    o.predicate = NSPredicate(format: "mediaType == %d OR mediaType == %d", PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
    return PHAsset.fetchAssets(with: o)
  }

  func start() {
    guard recent == nil else { return }
    recent = Self.recentFetch()
    PHPhotoLibrary.shared().register(self)
  }

  func stop() { PHPhotoLibrary.shared().unregisterChangeObserver(self); recent = nil }

  func photoLibraryDidChange(_ change: PHChange) {
    guard let before = recent, let d = change.changeDetails(for: before) else { return }
    recent = d.fetchResultAfterChanges
    let ids = d.insertedObjects.map { $0.localIdentifier }
    guard !ids.isEmpty else { return }
    PendingQueue.add(ids)
    if let newest = d.insertedObjects.compactMap({ $0.creationDate }).max(), newest > PendingQueue.watermark {
      PendingQueue.watermark = newest
    }
    BackgroundSync.schedule()          // make sure a processing task is queued in case we get suspended
    onNewAssets?(ids)
  }
}
