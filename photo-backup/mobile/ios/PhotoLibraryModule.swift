import Photos
import React

@objc(PhotoLibrary)
final class PhotoLibraryModule: RCTEventEmitter {
  override init() { super.init(); BackgroundSync.emitter = self }
  override static func requiresMainQueueSetup() -> Bool { false }
  override func supportedEvents() -> [String]! { ["BackgroundSyncStarted", "BackgroundSyncExpiring", "NewAssets"] }

  @objc func startWatching(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
      guard status == .authorized || status == .limited else { return reject("E_PERMISSION", "Photos access denied", nil) }
      PhotoLibraryWatcher.shared.onNewAssets = { [weak self] ids in self?.sendEvent(withName: "NewAssets", body: ids) }
      PhotoLibraryWatcher.shared.start()
      BackgroundSync.schedule()
      resolve(nil)
    }
  }

  @objc func getPendingAssetIds(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { resolve(PendingQueue.all()) }
  @objc func ackPendingAssetIds(_ ids: [String], resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { PendingQueue.remove(ids); resolve(nil) }
  @objc func completeBackgroundTask(_ ok: Bool, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) { BackgroundSync.complete(success: ok); resolve(nil) }

  @objc func enqueueAssetsSince(_ sinceMs: Double, resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let since = max(Date(timeIntervalSince1970: sinceMs / 1000), PendingQueue.watermark)
    resolve(BackgroundSync.enqueueAssets(since: since))
  }

  @objc func assetsExist(_ ids: [String], resolver resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
    let r = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
    var out: [String] = []; r.enumerateObjects { a, _, _ in out.append(a.localIdentifier) }
    resolve(out)
  }

  // Export the ORIGINAL bytes (network access allowed, so iCloud-optimized photos are pulled down first).
  @objc func exportAsset(_ id: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
      return reject("E_ASSET_GONE", "asset no longer exists", nil)
    }
    let res = PHAssetResource.assetResources(for: asset)
    guard let r = res.first(where: { $0.type == .photo || $0.type == .video }) ?? res.first else {
      return reject("E_NO_RESOURCE", "no resource", nil)
    }
    let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("bkz-\(UUID().uuidString)")
    let opts = PHAssetResourceRequestOptions(); opts.isNetworkAccessAllowed = true
    PHAssetResourceManager.default().writeData(for: r, toFile: url, options: opts) { err in
      if let err = err { return reject("E_EXPORT", err.localizedDescription, err) }
      let size = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.doubleValue ?? 0
      resolve([
        "path": url.path,
        "mediaType": asset.mediaType == .video ? "video" : "image",
        "takenAtMs": (asset.creationDate ?? Date()).timeIntervalSince1970 * 1000,
        "modifiedAtMs": (asset.modificationDate ?? Date()).timeIntervalSince1970 * 1000,
        "size": size,
      ])
    }
  }

  // Free Up Space: one performChanges call == ONE system alert ("Allow X to delete N photos?").
  // Deleted items go to Recently Deleted for 30 days; iOS does not free space until that album is emptied.
  @objc func deleteAssets(_ ids: [String], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
    guard assets.count > 0 else { return resolve(["deletedIds": ids]) }
    PHPhotoLibrary.shared().performChanges({
      PHAssetChangeRequest.deleteAssets(assets as NSFastEnumeration)
    }) { success, error in
      if success {
        let left = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var still = Set<String>(); left.enumerateObjects { a, _, _ in still.insert(a.localIdentifier) }
        return resolve(["deletedIds": ids.filter { !still.contains($0) }])
      }
      let ns = error as NSError?
      if ns?.domain == PHPhotosErrorDomain && ns?.code == PHPhotosError.userCancelled.rawValue {
        return reject("USER_CANCELLED", "User declined deletion", error)
      }
      reject("E_DELETE", error?.localizedDescription ?? "delete failed", error)
    }
  }
}
