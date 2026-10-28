import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'share/bookmark_api.dart';
import 'share/share_feedback.dart';
import 'share/share_ingest_service.dart';
import 'share/share_queue.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Keys come from the build command: flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...
  // The anon key is meant to be public. Row Level Security is what protects the data. Never ship the service_role key.
  await Supabase.initialize(
    url: const String.fromEnvironment('SUPABASE_URL'),
    anonKey: const String.fromEnvironment('SUPABASE_ANON_KEY'),
  );

  final queue = await ShareQueue.open();
  final service = ShareIngestService(
    queue: queue,
    api: SupabaseBookmarkApi(Supabase.instance.client),
    extraTriggers: Supabase.instance.client.auth.onAuthStateChange, // sync right after sign-in
  );
  final launchedByShare = await service.start();

  runApp(BukmarkzApp(service: service, closeAfterShare: launchedByShare && Platform.isAndroid));
}

class BukmarkzApp extends StatelessWidget {
  const BukmarkzApp({super.key, required this.service, required this.closeAfterShare});

  final ShareIngestService service;
  final bool closeAfterShare;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Bukmarkz AI',
      home: ShareFeedback(
        service: service,
        closeAfterFirstResult: closeAfterShare,
        child: const Scaffold(body: Center(child: Text('Bukmarkz AI'))), // replace with your real home screen
      ),
    );
  }
}
