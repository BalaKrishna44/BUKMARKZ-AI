import 'dart:math';

import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';
import 'package:uuid/uuid.dart';

import 'shared_content.dart';

/// One saved-but-not-yet-synced share.
class QueuedShare {
  const QueuedShare({
    required this.id,
    required this.createdAt,
    required this.attempts,
    this.url,
    this.note,
    this.source,
    this.lastError,
  });

  /// Generated on the device. The server stores it as the primary key, so sending the same item twice is harmless.
  final String id;
  final String? url;
  final String? note;
  final String? source;
  final int createdAt;
  final int attempts;
  final String? lastError;

  factory QueuedShare.fromRow(Map<String, Object?> row) => QueuedShare(
        id: row['id']! as String,
        url: row['url'] as String?,
        note: row['note'] as String?,
        source: row['source'] as String?,
        createdAt: row['created_at']! as int,
        attempts: row['attempts']! as int,
        lastError: row['last_error'] as String?,
      );
}

/// A small SQLite-backed outbox. Shares are written here FIRST, before any network call, so nothing is lost
/// when the phone is offline, the app is killed, or the server is down.
class ShareQueue {
  ShareQueue._(this._db);

  final Database _db;

  /// After this many failed attempts an item stops retrying and waits in "failed" for you to look at it.
  static const int maxAttempts = 8;

  static Future<ShareQueue> open() async {
    final path = p.join(await getDatabasesPath(), 'share_queue.db');
    final db = await openDatabase(
      path,
      version: 1,
      onCreate: (db, _) async {
        await db.execute('''
          CREATE TABLE share_queue (
            id TEXT PRIMARY KEY,
            url TEXT,
            note TEXT,
            source TEXT,
            created_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            status TEXT NOT NULL DEFAULT 'pending'
          )''');
        await db.execute('CREATE INDEX idx_share_queue_due ON share_queue (status, next_attempt_at)');
      },
    );
    return ShareQueue._(db);
  }

  static int _now() => DateTime.now().millisecondsSinceEpoch;

  /// Saves a share. Sharing the same link twice while the first is still waiting returns the existing item.
  Future<QueuedShare> enqueue(SharedContent content) async {
    return _db.transaction((txn) async {
      if (content.url != null) {
        final existing = await txn.query(
          'share_queue',
          where: "url = ? AND status = 'pending'",
          whereArgs: [content.url],
          limit: 1,
        );
        if (existing.isNotEmpty) return QueuedShare.fromRow(existing.first);
      }
      final id = const Uuid().v4();
      final createdAt = _now();
      await txn.insert('share_queue', {
        'id': id,
        'url': content.url,
        'note': content.note,
        'source': content.source,
        'created_at': createdAt,
      });
      return QueuedShare(id: id, url: content.url, note: content.note, source: content.source, createdAt: createdAt, attempts: 0);
    });
  }

  /// Items that are ready to send now, oldest first.
  Future<List<QueuedShare>> due({int limit = 20}) async {
    final rows = await _db.query(
      'share_queue',
      where: "status = 'pending' AND next_attempt_at <= ?",
      whereArgs: [_now()],
      orderBy: 'created_at ASC',
      limit: limit,
    );
    return rows.map(QueuedShare.fromRow).toList();
  }

  Future<void> markSent(String id) => _db.delete('share_queue', where: 'id = ?', whereArgs: [id]);

  /// A temporary problem (offline, timeout, server error): try again later, waiting longer each time.
  Future<void> markRetry(String id, String error) async {
    await _db.transaction((txn) async {
      final rows = await txn.query('share_queue', columns: ['attempts'], where: 'id = ?', whereArgs: [id], limit: 1);
      if (rows.isEmpty) return;
      final attempts = (rows.first['attempts']! as int) + 1;
      await txn.update(
        'share_queue',
        {
          'attempts': attempts,
          'last_error': error,
          'next_attempt_at': _now() + backoff(attempts).inMilliseconds,
          'status': attempts >= maxAttempts ? 'failed' : 'pending',
        },
        where: 'id = ?',
        whereArgs: [id],
      );
    });
  }

  /// A permanent problem (the server rejected the data): retrying will not help.
  Future<void> markFailed(String id, String error) => _db.update(
        'share_queue',
        {'status': 'failed', 'last_error': error},
        where: 'id = ?',
        whereArgs: [id],
      );

  /// 30 s, 1 min, 2 min, 4 min ... capped at 1 hour.
  static Duration backoff(int attempts) {
    final seconds = min(30 * (1 << min(attempts, 7)), 3600);
    return Duration(seconds: seconds);
  }

  Future<int> pendingCount() async {
    final r = await _db.rawQuery("SELECT COUNT(*) AS n FROM share_queue WHERE status = 'pending'");
    return (r.first['n']! as int);
  }

  Future<List<QueuedShare>> failed() async {
    final rows = await _db.query('share_queue', where: "status = 'failed'", orderBy: 'created_at ASC');
    return rows.map(QueuedShare.fromRow).toList();
  }

  /// When the earliest waiting item becomes due (milliseconds since epoch), or null if nothing is waiting.
  Future<int?> nextDueAt() async {
    final r = await _db.rawQuery("SELECT MIN(next_attempt_at) AS t FROM share_queue WHERE status = 'pending'");
    return r.first['t'] as int?;
  }
}
