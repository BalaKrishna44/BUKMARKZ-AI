import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';

import 'share_queue.dart';

enum SendOutcome {
  /// Stored on the server (or it was already there).
  sent,

  /// Temporary problem. Keep it in the queue and try again later.
  retry,

  /// Nobody is signed in, or the session could not be refreshed. Keep everything and sync after sign-in.
  needsLogin,

  /// The server refused this item for good. Retrying will not help.
  rejected,
}

class SendResult {
  const SendResult(this.outcome, [this.detail]);
  final SendOutcome outcome;
  final String? detail;
}

/// The only thing the sync loop needs from a backend. Swap the implementation to change backends.
abstract interface class BookmarkApi {
  Future<SendResult> send(QueuedShare item);
}

/// Saves bookmarks with a plain insert into the `bookmarks` table (see supabase/bookmarks.sql).
/// Row Level Security makes sure each person can only write their own rows.
class SupabaseBookmarkApi implements BookmarkApi {
  SupabaseBookmarkApi(this._client);

  final SupabaseClient _client;

  @override
  Future<SendResult> send(QueuedShare item) async {
    final session = _client.auth.currentSession;
    if (session == null) return const SendResult(SendOutcome.needsLogin);

    try {
      // A share can arrive just as the app wakes up with an old token: refresh it first.
      if (session.isExpired) await _client.auth.refreshSession();

      await _client.from('bookmarks').insert({
        'id': item.id, // chosen on the device, so a retry cannot create a duplicate
        'url': item.url,
        'note': item.note,
        'source': item.source,
        // user_id is filled in by the database from the signed-in user (default auth.uid())
      }).timeout(const Duration(seconds: 15));
      return const SendResult(SendOutcome.sent);
    } on PostgrestException catch (e) {
      final code = e.code ?? '';
      // 23505 unique violation: the same id or the same link is already saved. That is a success for us.
      if (code == '23505') return const SendResult(SendOutcome.sent);
      // 42501 (row-level security) or PGRST3xx (JWT problems): the request was not authenticated.
      if (code == '42501' || code.startsWith('PGRST3')) return SendResult(SendOutcome.needsLogin, e.message);
      // check_violation, not_null_violation, invalid_text_representation: the data itself is wrong.
      if (code == '23514' || code == '23502' || code == '22P02') return SendResult(SendOutcome.rejected, e.message);
      return SendResult(SendOutcome.retry, e.message);
    } on AuthException catch (e) {
      return SendResult(SendOutcome.needsLogin, e.message);
    } on TimeoutException {
      return const SendResult(SendOutcome.retry, 'timeout');
    } on Exception catch (e) {
      // SocketException, ClientException and friends: no network, DNS failure, connection reset.
      return SendResult(SendOutcome.retry, e.toString());
    }
  }
}
