# Bukmarkz share kit

Receives links and text from the iOS and Android share sheets, queues them on the device, and syncs them to Supabase.

1. `supabase/bookmarks.sql`          run once in the Supabase SQL editor
2. `pubspec.dependencies.yaml`       add the packages
3. `native/*`                        Android manifest + iOS extension (follow the guide's Xcode steps)
4. `lib/share/*`, `lib/main.dart`    copy into your app (change the import in test/ to your package name)
5. Run: flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...

Test on Android (replace the package name):
  adb shell am start -a android.intent.action.SEND -t text/plain \
    --es android.intent.extra.TEXT "Great read https://example.com/a?utm_source=x" \
    -n com.yourcompany.bukmarkz/.MainActivity

NOT compiled by the author: no Dart/Flutter toolchain was available. Run `flutter analyze` and `flutter test` first.
