/// What the user shared, cleaned up and ready to store.
class SharedContent {
  const SharedContent({this.url, this.note, this.source});

  /// A clean http(s) address, if the shared text contained one.
  final String? url;

  /// Any text that came with the link (a caption), or the whole text when there is no link.
  final String? note;

  /// Where it came from, e.g. "android-share" or "ios-share".
  final String? source;

  bool get hasUrl => url != null;
}

/// Turns raw shared text into a [SharedContent].
///
/// Apps rarely share a bare URL: Instagram, LinkedIn and Chrome usually send a sentence that contains the link,
/// so we find the first http(s) address, tidy it, and keep the rest of the text as a note.
abstract final class ShareParser {
  static final RegExp _urlPattern = RegExp(r'https?://[^\s<>"]+', caseSensitive: false);

  /// Query parameters that only track where a click came from.
  static const Set<String> _trackingParams = {
    'fbclid', 'gclid', 'igshid', 'igsh', 'mc_cid', 'mc_eid', 'trk', 'trackingid', 'refid',
  };

  static const int maxNoteLength = 2000;

  static SharedContent? parse(String? raw, {String? source}) {
    final text = raw?.trim() ?? '';
    if (text.isEmpty) return null;

    final match = _urlPattern.firstMatch(text);
    if (match != null) {
      final url = _canonical(_trimTrailing(match.group(0)!));
      if (url != null) {
        final rest = text.substring(0, match.start) + ' ' + text.substring(match.end);
        final note = _tidyNote(rest);
        return SharedContent(url: url, note: note.isEmpty ? null : note, source: source);
      }
    }
    // No usable web address (plain text, "javascript:" or "ftp:" links, ...): keep it as a note only.
    return SharedContent(note: _clip(text), source: source);
  }

  /// Removes punctuation that belongs to the sentence, not the link: "see https://a.com/x." or "(https://a.com/x)".
  static String _trimTrailing(String url) {
    var out = url;
    while (out.isNotEmpty) {
      final last = out[out.length - 1];
      if ('.,;:!?\'"]}'.contains(last)) {
        out = out.substring(0, out.length - 1);
        continue;
      }
      // keep a closing bracket only when the URL itself opened one (Wikipedia: .../Foo_(bar))
      if (last == ')' && _count(out, ')') > _count(out, '(')) {
        out = out.substring(0, out.length - 1);
        continue;
      }
      break;
    }
    return out;
  }

  static int _count(String s, String ch) => s.split(ch).length - 1;

  /// Validates the address and strips tracking parameters. Works on the string so nothing gets re-encoded.
  static String? _canonical(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null || uri.host.isEmpty || (uri.scheme != 'http' && uri.scheme != 'https')) return null;

    var work = url;
    var hash = '';
    final h = url.indexOf('#');
    if (h >= 0) {
      work = url.substring(0, h);
      hash = url.substring(h);
      if (hash.startsWith('#:~:')) hash = ''; // "scroll to text" fragments only mean something in the sender's browser
    }

    var base = work;
    var kept = <String>[];
    final q = work.indexOf('?');
    if (q >= 0) {
      base = work.substring(0, q);
      kept = work.substring(q + 1).split('&').where((pair) {
        if (pair.isEmpty) return false;
        final key = pair.split('=').first.toLowerCase();
        return !(key.startsWith('utm_') || _trackingParams.contains(key));
      }).toList();
    }
    final query = kept.isEmpty ? '' : '?${kept.join('&')}';
    return '$base$query$hash';
  }

  static String _tidyNote(String text) {
    final collapsed = text.replaceAll(RegExp(r'\s+'), ' ').trim();
    final stripped = collapsed.replaceAll(RegExp(r'^[\s:|\-–—]+|[\s:|\-–—]+$'), '');
    return _clip(stripped);
  }

  static String _clip(String s) => s.length <= maxNoteLength ? s : s.substring(0, maxNoteLength);
}
