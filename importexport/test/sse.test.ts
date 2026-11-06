import { SseParser } from '../lib/import/sse';
let f = 0; const ok = (c: boolean, m: string) => { if (!c) { f++; console.log('FAIL', m); } };
const p = new SseParser();
let e = p.push('event: progress\ndata: {"processed":5,"to'); ok(e.length === 0, 'partial held');
e = p.push('tal":10}\n\nevent: done\r\ndata: {"inserted":9}\r\n\n'); ok(e.length === 2 && e[0].data.total === 10 && e[1].event === 'done' && e[1].data.inserted === 9, 'split + CRLF');
ok(new SseParser().push('event: x\ndata: {bad\n\n').length === 0, 'malformed ignored');
ok(new SseParser().push('data: {"a":1}\n\n')[0].event === 'message', 'default event');
const q = new SseParser(); let n = 0; for (const ch of 'event: a\ndata: {"k":1}\n\nevent: b\ndata: {"k":2}\n\n') n += q.push(ch).length; ok(n === 2, 'char-by-char');
console.log(f ? `${f} failed` : 'sse ok');
