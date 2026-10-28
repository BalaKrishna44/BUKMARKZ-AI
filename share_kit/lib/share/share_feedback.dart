import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'share_ingest_service.dart';

/// Wrap your app's home with this. It confirms each share with a small message, and when the app was started
/// by a share on Android it hands the user straight back to the app they came from.
class ShareFeedback extends StatefulWidget {
  const ShareFeedback({
    super.key,
    required this.service,
    required this.child,
    this.closeAfterFirstResult = false,
  });

  final ShareIngestService service;
  final Widget child;

  /// Pass `launchedByShare && Platform.isAndroid` from main(). iOS has no API to return to the previous app.
  final bool closeAfterFirstResult;

  @override
  State<ShareFeedback> createState() => _ShareFeedbackState();
}

class _ShareFeedbackState extends State<ShareFeedback> {
  final GlobalKey<ScaffoldMessengerState> _messenger = GlobalKey<ScaffoldMessengerState>();
  StreamSubscription<ShareEvent>? _sub;
  bool _closing = false;

  @override
  void initState() {
    super.initState();
    _sub = widget.service.events.listen(_onEvent);
  }

  void _onEvent(ShareEvent e) {
    final text = switch (e.type) {
      ShareEventType.queued => null, // too quick to be worth a message
      ShareEventType.sent => 'Saved to Bukmarkz',
      ShareEventType.deferred => 'Saved on this device. It will sync when you are back online.',
      ShareEventType.needsLogin => 'Saved on this device. Sign in to finish saving.',
      ShareEventType.failed => 'Could not save this one.',
    };
    if (text != null) {
      _messenger.currentState?.showSnackBar(SnackBar(content: Text(text), duration: const Duration(seconds: 2)));
    }

    // Close only when there is nothing more for the person to do.
    final done = e.type == ShareEventType.sent || e.type == ShareEventType.deferred;
    if (widget.closeAfterFirstResult && done && !_closing && Platform.isAndroid) {
      _closing = true;
      Future<void>.delayed(const Duration(milliseconds: 1200), SystemNavigator.pop);
    }
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ScaffoldMessenger(key: _messenger, child: widget.child);
  }
}
