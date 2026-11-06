/** Incremental Server-Sent-Events reader for POST /api/import. Feed it text chunks; it returns the complete events seen so far. */
export interface SseEvent { event: string; data: any }
export class SseParser {
  private buf = '';
  push(chunk: string): SseEvent[] {
    this.buf += chunk.replace(/\r\n/g, '\n');
    const out: SseEvent[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const block = this.buf.slice(0, i); this.buf = this.buf.slice(i + 2);
      let event = 'message'; const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (!data.length) continue;
      try { out.push({ event, data: JSON.parse(data.join('\n')) }); } catch { /* ignore a malformed block */ }
    }
    return out;
  }
}
