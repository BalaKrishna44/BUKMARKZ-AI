"""Loads bukmarkz/settings.py under different environments and checks the security-relevant values.
Runs without Django installed (only django.core.exceptions is stubbed). Run: python3 -m unittest tests.test_settings_hardening"""
import os, runpy, sys, types, unittest, warnings
from pathlib import Path

SETTINGS = str(Path(__file__).resolve().parent.parent / 'bukmarkz' / 'settings.py')
class ImproperlyConfigured(Exception): pass
for name in ('django', 'django.core', 'django.core.exceptions'):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules['django.core.exceptions'].ImproperlyConfigured = ImproperlyConfigured

GOOD_KEY = 'k' * 64
PROD = {'ENVIRONMENT': 'PRODUCTION', 'SECRET_KEY': GOOD_KEY, 'SQL_PASSWORD': 'p' * 20, 'STRIPE_SECRET_KEY': 'sk_live_' + 'a' * 30}

def load(env):
    keep = {k: os.environ.get(k) for k in set(os.environ) | set(env)}
    for k in list(os.environ):
        if k in ('ENVIRONMENT', 'SECRET_KEY', 'SECRET_KEY_FALLBACKS', 'DEBUG', 'SQL_PASSWORD', 'STRIPE_SECRET_KEY', 'EXTENSION_IDS', 'ALLOW_INSECURE_HTTP', 'DJANGO_EXTRA_ALLOWED_HOSTS', 'HSTS_PRELOAD', 'CORS_ALLOWED_ORIGINS', 'DJANGO_ALLOWED_HOSTS'):
            del os.environ[k]
    os.environ.update(env)
    try:
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter('always'); ns = runpy.run_path(SETTINGS); ns['_warnings'] = [str(x.message) for x in w]; return ns
    finally:
        for k in set(os.environ) | set(keep):
            if keep.get(k) is None: os.environ.pop(k, None)
            else: os.environ[k] = keep[k]

class Prod(unittest.TestCase):
    def test_debug_is_off_even_if_env_says_on(self):
        self.assertIs(load({**PROD, 'DEBUG': '1'})['DEBUG'], False)
    def test_hosts_are_explicit(self):
        h = load(PROD)['ALLOWED_HOSTS']; self.assertEqual(h, ['bukmarkz.com', 'www.bukmarkz.com', 'api.bukmarkz.com', 'localhost']); self.assertNotIn('*', h)
    def test_bare_ip_host_is_refused_in_production(self):
        self.assertNotIn('159.65.127.14', load({**PROD, 'DJANGO_EXTRA_ALLOWED_HOSTS': '159.65.127.14 staging.bukmarkz.com'})['ALLOWED_HOSTS'])
        self.assertIn('staging.bukmarkz.com', load({**PROD, 'DJANGO_EXTRA_ALLOWED_HOSTS': 'staging.bukmarkz.com'})['ALLOWED_HOSTS'])
    def test_weak_or_missing_secret_key_stops_startup(self):
        for key in (None, 'ASDshort', 'k' * 49):
            env = {k: v for k, v in PROD.items() if k != 'SECRET_KEY'}
            if key: env['SECRET_KEY'] = key
            with self.assertRaises(ImproperlyConfigured, msg=str(key)): load(env)
    def test_missing_db_password_and_stripe_stop_startup(self):
        for drop in ('SQL_PASSWORD', 'STRIPE_SECRET_KEY'):
            with self.assertRaises(ImproperlyConfigured): load({k: v for k, v in PROD.items() if k != drop})
    def test_cors_exact_origins_no_credentials_no_localhost_no_ip(self):
        s = load(PROD)
        self.assertEqual(s['CORS_ALLOWED_ORIGINS'], ['https://bukmarkz.com', 'https://www.bukmarkz.com'])
        self.assertIs(s['CORS_ALLOW_CREDENTIALS'], False); self.assertNotIn('CORS_ALLOW_ALL_ORIGINS', s); self.assertNotIn('CORS_ORIGIN_ALLOW_ALL', s)
        self.assertEqual(s['CORS_URLS_REGEX'], r'^/api/.*$')
    def test_extension_ids_are_validated_and_added(self):
        good = 'abcdefghijklmnopabcdefghijklmnop'
        self.assertIn(f'chrome-extension://{good}', load({**PROD, 'EXTENSION_IDS': good})['CORS_ALLOWED_ORIGINS'])
        for bad in ('short', 'A' * 32, 'q' * 32, good + 'x', '*', 'abcdefghijklmnopabcdefghijklmnop/evil'):
            with self.assertRaises(ImproperlyConfigured, msg=bad): load({**PROD, 'EXTENSION_IDS': bad})
    def test_https_enforced_by_default(self):
        s = load(PROD)
        for k in ('SECURE_SSL_REDIRECT', 'SESSION_COOKIE_SECURE', 'CSRF_COOKIE_SECURE', 'SECURE_HSTS_INCLUDE_SUBDOMAINS'): self.assertIs(s[k], True, k)
        self.assertEqual(s['SECURE_HSTS_SECONDS'], 31536000); self.assertIs(s['SECURE_HSTS_PRELOAD'], False); self.assertEqual(s['SECURE_PROXY_SSL_HEADER'], ('HTTP_X_FORWARDED_PROTO', 'https'))
        self.assertIs(load({**PROD, 'HSTS_PRELOAD': '1'})['SECURE_HSTS_PRELOAD'], True)
    def test_insecure_opt_out_is_explicit(self):
        self.assertNotIn('SECURE_SSL_REDIRECT', load({**PROD, 'ALLOW_INSECURE_HTTP': '1'}))
    def test_other_headers_and_drf(self):
        s = load(PROD)
        self.assertEqual(s['X_FRAME_OPTIONS'], 'DENY'); self.assertIs(s['SECURE_CONTENT_TYPE_NOSNIFF'], True); self.assertIs(s['SESSION_COOKIE_HTTPONLY'], True)
        self.assertEqual(s['REST_FRAMEWORK']['DEFAULT_PERMISSION_CLASSES'], ['rest_framework.permissions.IsAuthenticated'])
        self.assertEqual(s['REST_FRAMEWORK']['DEFAULT_RENDERER_CLASSES'], ('rest_framework.renderers.JSONRenderer',))
    def test_stripe_test_key_warns(self):
        self.assertTrue(any('LIVE key' in w for w in load({**PROD, 'STRIPE_SECRET_KEY': 'sk_test_' + 'a' * 30})['_warnings']))
        self.assertFalse(any('LIVE key' in w for w in load(PROD)['_warnings']))
    def test_key_rotation_fallbacks(self):
        self.assertEqual(load({**PROD, 'SECRET_KEY_FALLBACKS': 'old1 old2'})['SECRET_KEY_FALLBACKS'], ['old1', 'old2'])

class Dev(unittest.TestCase):
    def test_debug_is_opt_in(self):
        self.assertIs(load({})['DEBUG'], False); self.assertIs(load({'DEBUG': '1'})['DEBUG'], True)
    def test_dev_starts_without_secrets_and_allows_localhost_cors(self):
        s = load({}); self.assertTrue(s['SECRET_KEY']); self.assertIn('http://localhost:3000', s['CORS_ALLOWED_ORIGINS']); self.assertNotIn('SECURE_SSL_REDIRECT', s)

if __name__ == '__main__': unittest.main()
