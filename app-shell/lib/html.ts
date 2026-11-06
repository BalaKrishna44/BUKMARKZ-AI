import sanitizeHtml from 'sanitize-html';

/**
 * Feed HTML is hostile input. Allow-list only: no script/style/iframe/form/event handlers,
 * only http(s) links and images, links forced to rel=noopener nofollow ugc and target=_blank.
 */
export function cleanHtml(html: string, baseUrl?: string): string {
  const abs = (v?: string) => { try { return v ? new URL(v, baseUrl).toString() : v; } catch { return undefined; } };
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'], img: ['src', 'alt', 'title'], th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'] },
    allowedSchemes: ['http', 'https'],
    allowedSchemesAppliedToAttributes: ['href', 'src'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (_t, attribs) => ({ tagName: 'a', attribs: { ...attribs, href: abs(attribs.href) ?? '', rel: 'noopener nofollow ugc', target: '_blank' } }),
      img: (_t, attribs) => ({ tagName: 'img', attribs: { ...attribs, src: abs(attribs.src) ?? '' } }),
    },
    exclusiveFilter: (f) => f.tag === 'img' && !f.attribs.src,   // drop images whose URL was invalid/removed
  }).trim();
}

export function htmlToText(html: string): string {
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {}, textFilter: (t) => t + ' ' });
  return text.replace(/&nbsp;/g, ' ').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/ +([.,;:!?])/g, '$1').trim();
}

export const excerptOf = (text: string, max = 280) => (text.length <= max ? text : text.slice(0, max).replace(/\s+\S*$/, '') + '…');
