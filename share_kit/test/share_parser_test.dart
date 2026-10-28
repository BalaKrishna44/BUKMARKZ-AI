import 'package:flutter_test/flutter_test.dart';
import 'package:your_app/share/shared_content.dart'; // change "your_app" to the name in your pubspec.yaml

void main() {
  test('plain link', () {
    final c = ShareParser.parse('https://example.com/a?id=5')!;
    expect(c.url, 'https://example.com/a?id=5');
    expect(c.note, isNull);
  });

  test('link inside a sentence keeps the sentence as a note and drops tracking params', () {
    final c = ShareParser.parse('Check this out! https://www.linkedin.com/posts/foo-123?trk=public_post&utm_medium=ios_app')!;
    expect(c.url, 'https://www.linkedin.com/posts/foo-123');
    expect(c.note, 'Check this out!');
  });

  test('trailing punctuation and brackets', () {
    expect(ShareParser.parse('see https://a.com/x, thanks')!.url, 'https://a.com/x');
    expect(ShareParser.parse('Read (https://en.wikipedia.org/wiki/Foo_(bar)).')!.url, 'https://en.wikipedia.org/wiki/Foo_(bar)');
    expect(ShareParser.parse('(https://a.com/x)')!.url, 'https://a.com/x');
  });

  test('fragments', () {
    expect(ShareParser.parse('https://a.com/p#:~:text=hello')!.url, 'https://a.com/p');
    expect(ShareParser.parse('https://a.com/#/route')!.url, 'https://a.com/#/route');
    expect(ShareParser.parse('https://a.com/x?utm_source=a#frag')!.url, 'https://a.com/x#frag');
  });

  test('only the first link is used', () {
    expect(ShareParser.parse('https://a.com/1 and https://b.com/2')!.url, 'https://a.com/1');
  });

  test('text without a web link becomes a note and is never treated as a URL', () {
    final c = ShareParser.parse('just a thought')!;
    expect(c.url, isNull);
    expect(c.note, 'just a thought');
    expect(ShareParser.parse('javascript:alert(1)')!.url, isNull);
    expect(ShareParser.parse('ftp://files.example.com/a')!.url, isNull);
  });

  test('empty input', () {
    expect(ShareParser.parse(null), isNull);
    expect(ShareParser.parse('   '), isNull);
  });

  test('very long text is clipped', () {
    expect(ShareParser.parse('x' * 5000)!.note!.length, ShareParser.maxNoteLength);
  });
}
