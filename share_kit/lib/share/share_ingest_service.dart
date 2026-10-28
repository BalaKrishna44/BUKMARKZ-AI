import 'dart:async';
import 'dart:io' show Platform;
import 'dart:math';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:receive_sharing_intent/receive_sharing_intent.dart';

import 'bookmark_api.dart';
import 'share_queue.dart';
import 'shared_content.dart';

enum ShareEventType {
  /// Written to the local queue (always the first thing that happens).
  queued,

  /// Confirmed by the server.
  sent,

  /// Could not reach the server; it stays queued and will retry.
  deferred,

  /// Nobody is signed in; it stays queued until sign-in.
  needsLogin,

  /// The server refused it for good.
  failed,
}

class ShareEvent {
  const ShareEvent(this.type, {this.url});
  final ShareEventType type;
  final String? url;
}

/// Receives links and text from the system share sheet and gets them to the server without losing any.
///
///   share sheet -> [start] listens -> parse -> write to the queue -> try to send -> (retry later if it fails)
///
/// It runs while the app is open or in the background, and also handles the share that launched the app.
class ShareIngestService with WidgetsBindingObserver {
  ShareIngestService({
    required this.queue,
    required this.api,
    this.extraTriggers,
  });

  final ShareQueue queue;
  final BookmarkApi api;

  /// Anything that should trigger a sync, e.g. `supabase.auth.onAuthStateChange` so queued items go out right after sign-in.
  final Stream<Object?>? extraTriggers;

  final StreamController<ShareEvent> _events = StreamController<ShareEvent>.broadcast();
  Stream<ShareEvent> get events => _events.stream;

  StreamSubscription<List<SharedMediaFile>>? _shareSub;
  StreamSubscription<List<ConnectivityResult>>? _netSub;
  StreamSubscription<Object?>? _triggerSub;
  Timer? _retryTimer;
  bool _started = false;
  bool _syncing = false;
  bool _syncAgain = false;

  /// Starts listening. Returns true when the app was launched BY a share (so the UI can stay minimal).
  Future<bool> start() async {
    if (_started) return false;
    _started = true;
    WidgetsBinding.instance.addObserver(this);

    // 1) Shares that arrive while the app is already running (foreground or background).
    _shareSub = ReceiveSharingIntent.instance.getMediaStream().listen(
      (files) => unawaited(_onShared(files)),
      onError: (Object e) => debugPrint('share stream error: $e'),
    );

    // 2) The share that started the app from a closed state.
    final initial = await ReceiveSharingIntent.instance.getInitialMedia();
    final launchedByShare = await _onShared(initial);
    // Tell the plugin we are done, otherwise the same share is delivered again on the next launch.
    ReceiveSharingIntent.instance.reset();

    // 3) Reasons to try the queue again.
    _netSub = Connectivity().onConnectivityChanged.listen((results) {
      if (!results.contains(ConnectivityResult.none)) unawaited(syncNow());
    });
    _triggerSub = extraTriggers?.listen((_) => unawaited(syncNow()));

    unawaited(syncNow()); // anything left over from last time
    return launchedByShare;
  }

  /// Returns true if at least one usable link or text was queued.
  Future<bool> _onShared(List<SharedMediaFile> files) async {
    var queuedAny = false;
    final source = Platform.isIOS ? 'ios-share' : 'android-share';

    for (final file in files) {
      // Images, videos and files are ignored: this app saves links and text.
      if (file.type != SharedMediaType.text && file.type != SharedMediaType.url) continue;

      var content = ShareParser.parse(file.path, source: source);
      if (content == null) continue;

      // iOS can pass the caption the person typed in the share sheet.
      final caption = file.message?.trim();
      if (caption != null && caption.isNotEmpty && content.hasUrl) {
        content = SharedContent(url: content.url, note: caption, source: source);
      }

      final saved = await queue.enqueue(content); // written to disk before anything else can fail
      _events.add(ShareEvent(ShareEventType.queued, url: saved.url));
      queuedAny = true;
    }

    if (queuedAny) unawaited(syncNow());
    return queuedAny;
  }

  /// Sends everything that is due. Safe to call from anywhere, any number of times.
  Future<void> syncNow() async {
    if (_syncing) {
      _syncAgain = true; // run once more when the current pass ends
      return;
    }
    _syncing = true;
    try {
      do {
        _syncAgain = false;
        final batch = await queue.due();
        sending:
        for (final item in batch) {
          final result = await api.send(item);
          switch (result.outcome) {
            case SendOutcome.sent:
              await queue.markSent(item.id);
              _events.add(ShareEvent(ShareEventType.sent, url: item.url));
            case SendOutcome.rejected:
              await queue.markFailed(item.id, result.detail ?? 'rejected');
              _events.add(ShareEvent(ShareEventType.failed, url: item.url));
            case SendOutcome.needsLogin:
              _events.add(ShareEvent(ShareEventType.needsLogin, url: item.url));
              return; // keep the whole queue; extraTriggers fires after sign-in
            case SendOutcome.retry:
              await queue.markRetry(item.id, result.detail ?? 'network');
              _events.add(ShareEvent(ShareEventType.deferred, url: item.url));
              break sending; // probably offline: do not hammer the rest of the queue
          }
        }
      } while (_syncAgain);
    } finally {
      _syncing = false;
      await _scheduleRetry();
    }
  }

  /// Wakes up when the earliest waiting item is due, even if the connection never "changes".
  Future<void> _scheduleRetry() async {
    _retryTimer?.cancel();
    final next = await queue.nextDueAt();
    if (next == null) return;
    final wait = max(next - DateTime.now().millisecondsSinceEpoch, 5000);
    _retryTimer = Timer(Duration(milliseconds: wait), () => unawaited(syncNow()));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(syncNow());
  }

  Future<void> dispose() async {
    WidgetsBinding.instance.removeObserver(this);
    await _shareSub?.cancel();
    await _netSub?.cancel();
    await _triggerSub?.cancel();
    _retryTimer?.cancel();
    await _events.close();
  }
}
