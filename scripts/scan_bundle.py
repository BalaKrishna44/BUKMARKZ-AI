#!/usr/bin/env python3
"""Scan built client output (Next .next/static, extension dist/, any folder or zip) for secrets that must never reach a browser.
Exit code 1 if anything is found. Prints rule + file + a masked sample, never the full secret.
Usage: python3 scan_bundle.py .next/static dist build ... [--allow-anon]"""
import base64, json, re, sys, zipfile
from pathlib import Path

RULES = {
    'Stripe secret/restricted key': r'\b[sr]k_(live|test)_[0-9A-Za-z]{10,}',
    'Stripe webhook secret': r'\bwhsec_[0-9A-Za-z]{10,}',
    'Google OAuth client secret': r'\bGOCSPX-[0-9A-Za-z_\-]{10,}',
    'SendGrid key': r'\bSG\.[0-9A-Za-z_\-]{16,}\.[0-9A-Za-z_\-]{16,}',
    'OpenAI key': r'\bsk-(?:proj-)?[0-9A-Za-z_\-]{32,}',
    'Anthropic key': r'\bsk-ant-[0-9A-Za-z_\-]{20,}',
    'GitHub token / OAuth secret': r'\b(?:gh[pousr]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,})',
    'AWS access key id': r'\bAKIA[0-9A-Z]{16}\b',
    'Private key block': r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'Slack token': r'\bxox[abprs]-[0-9A-Za-z\-]{10,}',
}
JWT = re.compile(r'\beyJ[0-9A-Za-z_\-]{8,}\.eyJ[0-9A-Za-z_\-]{8,}\.[0-9A-Za-z_\-]{8,}')
TEXT = {'.js', '.mjs', '.cjs', '.map', '.json', '.html', '.css', '.txt', '.env', '.ts', '.tsx', ''}

def mask(s): return s[:6] + '…' + s[-3:] if len(s) > 12 else '…'

def jwt_role(tok):
    try:
        p = tok.split('.')[1]; return json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4))).get('role')
    except Exception: return None

def scan_text(name, text):
    out = []
    for rule, rx in RULES.items():
        for m in re.finditer(rx, text): out.append((rule, name, mask(m.group(0))))
    for m in JWT.finditer(text):
        role = jwt_role(m.group(0))
        if role == 'service_role': out.append(('Supabase SERVICE ROLE key', name, mask(m.group(0))))
    return out

def walk(path):
    p = Path(path)
    if p.is_file() and p.suffix == '.zip':
        with zipfile.ZipFile(p) as z:
            for n in z.namelist():
                if Path(n).suffix in TEXT and not n.endswith('/'): yield f'{p}!{n}', z.read(n).decode('utf8', 'ignore')
    elif p.is_file():
        yield str(p), p.read_text('utf8', 'ignore')
    elif p.is_dir():
        for f in p.rglob('*'):
            if f.is_file() and f.suffix in TEXT and 'node_modules' not in f.parts and f.stat().st_size < 30_000_000:
                yield str(f), f.read_text('utf8', 'ignore')
        for z in p.rglob('*.zip'):
            yield from walk(z)
        # a shipped .env file is a finding in itself
        for f in p.rglob('.env*'):
            if f.is_file() and not f.name.endswith(('.example',)): print(f'FOUND  env file shipped: {f}')

def main(argv):
    paths = [a for a in argv if not a.startswith('--')]
    if not paths: print(__doc__); return 2
    found = [h for p in paths for name, text in walk(p) for h in scan_text(name, text)]
    for rule, name, sample in found: print(f'FOUND  {rule}: {name}  [{sample}]')
    print(f'{len(found)} finding(s)' if found else 'clean')
    return 1 if found else 0

if __name__ == '__main__': sys.exit(main(sys.argv[1:]))
