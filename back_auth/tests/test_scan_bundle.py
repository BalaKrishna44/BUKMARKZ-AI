import base64, json, subprocess, sys, tempfile, unittest
from pathlib import Path
SCAN = str(Path(__file__).resolve().parents[1] / 'scripts' / 'scan_bundle.py')
b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip('=')
jwt = lambda role: f"{b64({'alg':'HS256'})}.{b64({'role': role, 'ref': 'x'})}.c2lnbmF0dXJlc2lnbmF0dXJl"
def run(files):
    with tempfile.TemporaryDirectory() as d:
        for n, t in files.items(): (Path(d) / n).write_text(t)
        r = subprocess.run([sys.executable, SCAN, d], capture_output=True, text=True); return r.returncode, r.stdout
class T(unittest.TestCase):
    def test_clean_bundle_with_anon_key_and_public_stripe_key(self):
        rc, out = run({'a.js': f'const a="{jwt("anon")}"; const p="pk_live_{"a"*30}";'}); self.assertEqual(rc, 0, out)
    def test_service_role_is_found_and_masked(self):
        rc, out = run({'a.js': f'x="{jwt("service_role")}"'}); self.assertEqual(rc, 1); self.assertIn('SERVICE ROLE', out); self.assertNotIn('c2lnbmF0dXJl', out)
    def test_known_secret_shapes(self):
        for s in ('sk_live_' + 'a' * 24, 'sk_test_' + 'b' * 24, 'rk_live_' + 'c' * 24, 'whsec_' + 'd' * 24, 'GOCSPX-' + 'e' * 20, 'SG.' + 'f' * 20 + '.' + 'g' * 20, 'sk-ant-' + 'h' * 30, 'AKIA' + 'A' * 16, '-----BEGIN PRIVATE KEY-----'):
            rc, out = run({'bundle.js': f'var k="{s}";'}); self.assertEqual(rc, 1, s); self.assertNotIn(s, out, 'must mask')
    def test_shipped_env_file(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / '.env.production').write_text('X=1'); r = subprocess.run([sys.executable, SCAN, d], capture_output=True, text=True); self.assertIn('env file shipped', r.stdout)
if __name__ == '__main__': unittest.main()
