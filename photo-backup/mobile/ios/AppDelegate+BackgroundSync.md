In AppDelegate.swift, first line of `application(_:didFinishLaunchingWithOptions:)`:

    BackgroundSync.register()

Info.plist:

    <key>BGTaskSchedulerPermittedIdentifiers</key><array><string>com.bukmarkz.photosync</string></array>
    <key>UIBackgroundModes</key><array><string>processing</string></array>
    <key>NSPhotoLibraryUsageDescription</key><string>Back up your photos and videos, and remove local copies you approve.</string>
    <key>NSPhotoLibraryAddUsageDescription</key><string>Restore backed-up photos to your library.</string>
