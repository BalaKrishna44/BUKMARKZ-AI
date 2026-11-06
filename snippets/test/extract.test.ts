import { cleanCode, decodeEntities, detectLanguage, extractFromHtml, languageFromAttrs, normalizeLanguage, prepareForSave, secretKind, titleFromCode, worthSaving } from '../lib/snippets/extract';
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log('ok  ', m); } else { fail++; console.error('FAIL', m); } };
const eq = (a: unknown, b: unknown, m: string) => ok(a === b, m + (a === b ? '' : `  got ${JSON.stringify(a)} want ${JSON.stringify(b)}`));

// ---- language normalisation / hints
eq(normalizeLanguage('language-ts'), 'typescript', 'language-ts -> typescript');
eq(normalizeLanguage('Python'), 'python', 'case-insensitive');
eq(normalizeLanguage('highlight-source-js'), 'javascript', 'GitHub highlight-source-js');
eq(normalizeLanguage('shell-session'), 'bash', 'shell-session -> bash');
eq(normalizeLanguage('C++'), 'cpp', 'C++ -> cpp');
eq(normalizeLanguage('klingon'), null, 'unknown -> null');
eq(normalizeLanguage('<script>'), null, 'junk -> null');
eq(languageFromAttrs('class="hljs language-rust"'), 'rust', 'class hint');
eq(languageFromAttrs('data-lang="golang"'), 'go', 'data-lang hint');
eq(languageFromAttrs('class="prettyprint lang-py"'), 'python', 'prettyprint lang-py');
eq(languageFromAttrs('class="sourceCode"'), null, 'no hint');

// ---- detection
const D: [string, string, string][] = [
  ['#!/bin/bash\nset -e\necho hi', 'bash', 'shebang'],
  ['npm install --save-dev vitest', 'bash', 'npm command'],
  ['$ git clone https://github.com/a/b.git\n$ cd b', 'bash', 'prompted shell'],
  ['SELECT id, name\nFROM users\nWHERE active', 'sql', 'SQL'],
  ['create table t (id int);', 'sql', 'SQL create'],
  ['{"name":"x","n":[1,2]}', 'json', 'JSON'],
  ['def add(a, b):\n    return a + b', 'python', 'python def'],
  ['import os\nprint(os.getcwd())', 'python', 'python import/print'],
  ['const x = (a) => a * 2;\nconsole.log(x(2));', 'javascript', 'JS'],
  ['interface User { id: number }\nconst u: User = { id: 1 };', 'typescript', 'TS'],
  ['export function App(): JSX.Element {\n  return <Button onClick={go}>Hi</Button>;\n}', 'tsx', 'TSX'],
  ['package main\n\nfunc main() {\n\tfmt.Println("hi")\n}', 'go', 'Go'],
  ['fn main() {\n    let mut x = 5;\n    println!("{}", x);\n}', 'rust', 'Rust'],
  ['public class A {\n  public static void main(String[] a) {}\n}', 'java', 'Java'],
  ['#include <stdio.h>\nint main() { return 0; }', 'c', 'C'],
  ['<!DOCTYPE html>\n<html><body></body></html>', 'html', 'HTML'],
  ['.btn {\n  color: red;\n}', 'css', 'CSS'],
  ['name: ci\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest', 'yaml', 'YAML'],
  ['FROM node:20\nWORKDIR /app\nCOPY . .', 'dockerfile', 'Dockerfile'],
  ['diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b', 'diff', 'diff'],
  ['just some words\nacross lines', 'text', 'plain text falls back to text'],
];
for (const [code, lang, name] of D) eq(detectLanguage(code), lang, `detect: ${name}`);

// ---- cleaning
eq(cleanCode('\n\n    a();\r\n      b();   \n\n'), 'a();\n  b();', 'dedent, CRLF, trailing spaces, blank edges');
eq(cleanCode('$ npm i\n$ npm test'), 'npm i\nnpm test', 'strips $ prompts when every line has one');
eq(cleanCode('$ npm i\noutput line'), '$ npm i\noutput line', 'keeps $ when mixed with output');
eq(cleanCode('a\u0000b​c'), 'abc', 'control and zero-width chars removed');
eq(decodeEntities('a &lt; b &amp;&amp; c &gt; d &quot;x&quot; &#39;y&#39; &#x41; &nbsp;&unknown;'), 'a < b && c > d "x" \'y\' A  &unknown;', 'entities');
eq(decodeEntities('&#0;&#1;&#xD800;'), '', 'invalid code points dropped');
ok(worthSaving('npm install left-pad') && !worthSaving('ls') && !worthSaving('   ') && !worthSaving('x'.repeat(30000)), 'worthSaving bounds');
eq(titleFromCode('// Debounce helper\nfunction d(){}'), 'Debounce helper', 'title from leading comment');
eq(titleFromCode('#!/bin/sh\necho hi'), 'echo hi', 'title skips shebang');

// ---- secrets
eq(secretKind('const k = "AKIAIOSFODNN7REALKEY";'), 'AWS access key', 'AWS key');
eq(secretKind('Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'GitHub token', 'GitHub token');
eq(secretKind('-----BEGIN RSA PRIVATE KEY-----\nMIIE...'), 'private key', 'private key');
eq(secretKind('password = "hunter2hunter2xx9"'), 'hard-coded credential', 'hard-coded password');
eq(secretKind('const client = new Client({ apiKey: "YOUR_API_KEY_HERE_123" })'), null, 'doc placeholder is fine');
eq(secretKind('api_key = os.environ["API_KEY"]'), null, 'env lookup is fine');
eq(secretKind('const key = "sk-ant-api03-REPLACE-xxxxxxxxxxxxxxxxxxxxxxxx"'), null, 'sk- placeholder with xxx/replace-style is fine');
eq(secretKind('token = "abcdefghijkl"'), null, 'no digit -> not treated as a credential');
eq(secretKind('npm install express'), null, 'ordinary code is clean');

// ---- HTML extraction
const page = `<html><head><title>Fix &amp; tune Postgres &mdash; Blog</title></head><body>
<h2>Install</h2>
<div class="highlight highlight-source-shell"><pre>$ npm install pg</pre></div>
<h3>Connect</h3>
<pre class="lang-js"><code class="language-javascript"><span class="hljs-keyword">const</span> { Pool } = <span class="hljs-title">require</span>(<span class="hljs-string">'pg'</span>);
<span class="hljs-keyword">const</span> pool = <span class="hljs-keyword">new</span> Pool({ max: <span>10</span> });</code></pre>
<p>Query:</p>
<pre><code>SELECT *
FROM t
WHERE a &lt; 5 &amp;&amp; b &gt; 2</code></pre>
<pre><code>SELECT *
FROM t
WHERE a &lt; 5 &amp;&amp; b &gt; 2</code></pre>
<pre>x</pre>
<pre><span class="line-number">1</span> first line
<span class="line-number">2</span> second line here</pre>
<pre>const secret = "AKIAIOSFODNN7REALKEY"; // oops
doSomething(secret);</pre>
<pre>line one<br>line two<br/>line three</pre>
<script>var a = "<pre>this is inside a script string, not content</pre>";</script>
</body></html>`;
const r = extractFromHtml(page);
eq(r.pageTitle, 'Fix & tune Postgres — Blog', 'page title decoded');
eq(r.blocks.length, 6, 'six distinct worthwhile blocks (duplicate, 1-char block and script-string pre dropped)');
const [sh, js, sql, ln, sec, br] = r.blocks;
ok(sh.code === 'npm install pg' && sh.language === 'bash' && sh.title === 'Install', 'shell block: prompt stripped, language from wrapper class, title from heading');
ok(js.language === 'javascript' && js.code.startsWith("const { Pool } = require('pg');") && !js.code.includes('<span') && js.lines === 2 && js.title === 'Connect', 'highlighted JS: spans removed, language from <code> class');
ok(sql.code === 'SELECT *\nFROM t\nWHERE a < 5 && b > 2' && sql.language === 'sql', 'entities decoded, SQL detected without hints');
ok(ln.code === 'first line\nsecond line here', 'line-number gutter removed');
ok(sec.secret === 'AWS access key' && !sh.secret && !js.secret, 'secrets flagged per block');
ok(br.code === 'line one\nline two\nline three', '<br> becomes newline');
ok(extractFromHtml(page, { max: 2 }).blocks.length === 2 && extractFromHtml('<pre>'.repeat(5) + 'x'.repeat(50) + '</pre>', {}).blocks.length <= 25, 'max blocks honoured; unterminated markup is safe');
const big = '<pre>' + 'a = 1\n'.repeat(60) + '</pre>';
ok(extractFromHtml(big.repeat(40) .replace(/a = 1/g, (_m, i) => 'a = ' + i)).blocks.length === 25, 'hard cap of 25 blocks per page');
ok(extractFromHtml('').blocks.length === 0 && extractFromHtml('no code here').blocks.length === 0, 'empty / no code');
const t0 = Date.now(); extractFromHtml('<pre>' + '<span>x</span>'.repeat(200000)); ok(Date.now() - t0 < 2000, 'no catastrophic backtracking on hostile markup');

// ---- prepareForSave: the server re-cleans and re-checks whatever the client sent
let p: any = prepareForSave({ code: '\r\n  const a = 1;\r\n  const b = 2;  \r\n', language: 'TS', title: '  My   helper \n' });
ok(p.code === 'const a = 1;\nconst b = 2;' && p.language === 'typescript' && p.title === 'My helper', 'save: cleaned, language normalised, title tidied');
p = prepareForSave({ code: 'select 1;\nselect 2;', language: 'klingon' }); eq(p.language, 'sql', 'save: unknown language falls back to detection');
eq(prepareForSave({ code: 'x' }).error, 'too_short', 'save: too short');
eq(prepareForSave({ code: 'a\n'.repeat(15000) }).error, 'too_long', 'save: too long');
eq(prepareForSave({ code: 'a'.repeat(100000) }).error, 'too_long', 'save: absurdly long rejected cheaply');
p = prepareForSave({ code: 'aws_key = "AKIAIOSFODNN7REALKEY"\nprint(aws_key)' }); ok(p.error === 'secret' && p.secret === 'AWS access key', 'save: secrets are refused even if the client did not flag them');
p = prepareForSave({ code: 'echo hello world', title: '<img src=x onerror=alert(1)>' }); ok(p.title === '<img src=x onerror=alert(1)>', 'titles are plain text (React escapes on render; nothing is interpreted here)');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
