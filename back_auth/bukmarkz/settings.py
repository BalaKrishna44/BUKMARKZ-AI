import os
import re
import warnings

from django.core.exceptions import ImproperlyConfigured

# Build paths inside the project like this: os.path.join(BASE_DIR, ...)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/3.0/howto/deployment/checklist/

ENVIRONMENT = os.environ.get('ENVIRONMENT', 'DEVELOPMENT').upper()
PRODUCTION = ENVIRONMENT == 'PRODUCTION'


def _require(name, *, min_len=1):
    """A production secret must exist and be long enough; refuse to start otherwise (never fall back to a default)."""
    value = os.environ.get(name, '')
    if PRODUCTION and len(value) < min_len:
        raise ImproperlyConfigured(f'{name} must be set in production' + (f' (at least {min_len} characters)' if min_len > 1 else ''))
    return value


# SECURITY: the key signs sessions, password-reset and magic-link tokens. >= 50 random characters:
#   python -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY = _require('SECRET_KEY', min_len=50) or 'dev-only-insecure-key-do-not-use-in-production-' + 'x' * 10
# Key rotation without logging everyone out: put the OLD key(s) here (space separated) for a few days, then remove.
SECRET_KEY_FALLBACKS = [k for k in os.environ.get('SECRET_KEY_FALLBACKS', '').split(' ') if k]

# SECURITY: DEBUG can never be on in production, whatever the environment says. Elsewhere it is opt-in (DEBUG=1), not the default.
DEBUG = False if PRODUCTION else os.environ.get('DEBUG', '0') == '1'

ALLOWED_HOSTS = ['bukmarkz.com', 'www.bukmarkz.com', 'api.bukmarkz.com', 'localhost']
# Staging etc.: extra hosts via env. Never put a bare IP here in production.
ALLOWED_HOSTS += [h for h in os.environ.get('DJANGO_EXTRA_ALLOWED_HOSTS', '').split(' ') if h and not (PRODUCTION and re.fullmatch(r'[\d.:\[\]]+', h))]
CSRF_TRUSTED_ORIGINS = ['https://bukmarkz.com', 'https://www.bukmarkz.com', 'https://api.bukmarkz.com']
# Extra hosts (e.g. your-app.herokuapp.com) also need to be trusted for CSRF over https.
CSRF_TRUSTED_ORIGINS += ['https://' + h for h in os.environ.get('DJANGO_EXTRA_ALLOWED_HOSTS', '').split(' ') if h and not re.fullmatch(r'[\d.:\[\]]+', h)]

# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'whitenoise.runserver_nostatic',
    'django.contrib.staticfiles',

    'rest_framework',
    'rest_framework.authtoken',
    'knox',
    'django_rest_passwordreset',
    'corsheaders',
    'django_countries',

    'subscription.apps.SubscriptionConfig',
    'accounts.apps.AccountsConfig',
    'bookmarks.apps.BookmarksConfig',
    'import.apps.ImportConfig',
    'referral.apps.ReferralConfig',
    'contact.apps.ContactConfig',
    'default_bookmarks.apps.DefaultBookmarksConfig',
    'offers.apps.OffersConfig',
    'mailings.apps.MailingsConfig',
    'content.apps.ContentConfig'
]

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ('knox.auth.TokenAuthentication',),
    # JSON only: no browsable API (it advertises every endpoint and form to anyone who opens a URL)
    'DEFAULT_RENDERER_CLASSES': ('rest_framework.renderers.JSONRenderer',),
    # Secure by default: every view requires login unless it explicitly opts out
    # with permission_classes = [AllowAny] (or ()).
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
        'rest_framework.throttling.ScopedRateThrottle',
    ],
    'NUM_PROXIES': 1,  # we sit behind one nginx; stops clients spoofing X-Forwarded-For to dodge throttles
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/hour',
        'user': '2000/hour',
        'login': '10/minute',
        'register': '10/hour',
        'otp': '10/hour',
        'contact': '5/hour',
        'invite': '20/day',
        'withdraw': '5/day',
        'magic': '10/hour',
        'reset': '10/hour',
        'oauth': '30/hour',
        'passkey': '30/minute',
        'search': '60/minute',
        'extension': '120/hour',
    },
}

AUTH_USER_MODEL = 'accounts.CustomUser'

# Existing tables use 32-bit AutoField ids. Keep that so the Django upgrade creates no migrations.
DEFAULT_AUTO_FIELD = 'django.db.models.AutoField'

MIDDLEWARE = [
    # 'django.middleware.cache.UpdateCacheMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    # 'django.middleware.cache.FetchFromCacheMiddleware',
]

# CACHE_MIDDLEWARE_ALIAS = 'default'
# CACHE_MIDDLEWARE_SECONDS = 604800
# CACHE_MIDDLEWARE_KEY_PREFIX = ''

MAIN_URL = os.environ.get('MAIN_URL')

# --- CORS (django-cors-headers). Exact origins only: no wildcard, no regex, no credentials. ---
# Auth is a bearer token in the Authorization header, not a cookie, so cross-site requests never need credentials.
CORS_ALLOWED_ORIGINS = ['https://bukmarkz.com', 'https://www.bukmarkz.com']
if not PRODUCTION:
    CORS_ALLOWED_ORIGINS += ['http://localhost:3000', 'http://localhost:1337']
# Chrome extension(s) allowed to call this API from a page context. IDs are 32 letters a-p; set EXTENSION_IDS="id1 id2".
# (The v3.x extension calls the Next.js /api/ingest and Supabase, not this API, and requests from an extension's own
#  service worker with host permissions bypass CORS. Add its ID here only if a content script or popup calls Django directly.)
# Firefox uses a random per-install moz-extension:// UUID that cannot be allow-listed: it relies on host permissions instead.
_EXT_ID = re.compile(r'[a-p]{32}')
for _id in (i for i in os.environ.get('EXTENSION_IDS', '').split(' ') if i):
    if not _EXT_ID.fullmatch(_id):
        raise ImproperlyConfigured(f'EXTENSION_IDS: {_id!r} is not a valid Chrome extension ID')
    CORS_ALLOWED_ORIGINS.append(f'chrome-extension://{_id}')
CORS_ALLOW_CREDENTIALS = False
CORS_URLS_REGEX = r'^/api/.*$'                 # CORS headers only on API routes (not admin, static or media)
CORS_PREFLIGHT_MAX_AGE = 600

ROOT_URLCONF = 'bukmarkz.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [os.path.join(BASE_DIR, 'templates')],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'bukmarkz.wsgi.application'

# Database
# https://docs.djangoproject.com/en/3.0/ref/settings/#databases

DATABASES = {
    "default": {
        "ENGINE": os.environ.get("SQL_ENGINE", "django.db.backends.sqlite3"),
        "NAME": os.environ.get("SQL_DATABASE", os.path.join(BASE_DIR, "db.sqlite3")),
        "USER": os.environ.get("SQL_USER", "user"),
        "PASSWORD": _require('SQL_PASSWORD', min_len=16) if PRODUCTION and not os.environ.get('DATABASE_URL') else os.environ.get("SQL_PASSWORD", "password"),
        "HOST": os.environ.get("SQL_HOST", "localhost"),
        "PORT": os.environ.get("SQL_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

# Heroku (and most PaaS hosts) provide the database as one DATABASE_URL. When it is set it replaces the SQL_* values above.
# TLS is required: Heroku Postgres only accepts encrypted connections.
if os.environ.get('DATABASE_URL'):
    import dj_database_url
    DATABASES['default'] = dj_database_url.parse(os.environ['DATABASE_URL'], conn_max_age=600, ssl_require=PRODUCTION)

# Password validation
# https://docs.djangoproject.com/en/3.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {'min_length': 10},
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
# https://docs.djangoproject.com/en/3.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True

###############################################################################


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/3.0/howto/static-files/
STATIC_URL = '/staticfiles/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
# STATICFILES_STORAGE = 'whitenoise.storage.CompressedManifestStaticFilesStorage'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedStaticFilesStorage'},
}

# STATICFILES_DIRS = [
#     os.path.join(BASE_DIR, 'static')
# ]
###############################################################################


# Media files
# .replace('\\', '/')
MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, "media")

###############################################################################


# Email settings
EMAIL_HOST = 'localhost'
EMAIL_PORT = 1025
EMAIL_ADDRESS = os.environ.get('EMAIL_ADDRESS')
EMAIL_PASSWORD = os.environ.get("EMAIL_PASSWORD")
SENDGRID_API_KEY = os.environ.get('SENDGRID_API_KEY')
###############################################################################


# --- Auth: magic link, OAuth, password reset ---
MAGIC_LINK_TTL_MINUTES = 15
# Don't tell the caller whether an email has an account (the reset endpoint answers 200 either way).
DJANGO_REST_PASSWORDRESET_NO_INFORMATION_LEAKAGE = True
# Where the browser comes back to after Google/GitHub. EXACT match, and must also be registered with each provider.
OAUTH_ALLOWED_REDIRECTS = [u for u in os.environ.get('OAUTH_ALLOWED_REDIRECTS', ((MAIN_URL or '').rstrip('/') + '/auth/callback') if MAIN_URL else '').split(' ') if u]
OAUTH_PROVIDERS = {
    'google': {'client_id': os.environ.get('GOOGLE_OAUTH_CLIENT_ID'), 'client_secret': os.environ.get('GOOGLE_OAUTH_CLIENT_SECRET')},
    'github': {'client_id': os.environ.get('GITHUB_OAUTH_CLIENT_ID'), 'client_secret': os.environ.get('GITHUB_OAUTH_CLIENT_SECRET')},
}

# OpenAI (semantic search embeddings)
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
OPENAI_EMBEDDING_MODEL = os.environ.get('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small')
# --- AI auto-tagging and categorisation (cheap, fast models) ---
CLASSIFIER_ENABLED = os.environ.get('CLASSIFIER_ENABLED', '0') == '1'
CLASSIFIER_PROVIDER = os.environ.get('CLASSIFIER_PROVIDER', 'openai')      # 'openai' or 'anthropic'
CLASSIFIER_MODEL = os.environ.get('CLASSIFIER_MODEL', '')                  # blank = gpt-4o-mini / claude-haiku-5-5
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')
CLASSIFIER_ASYNC = True                  # classify in a background thread so saving stays instant
CLASSIFIER_AUTO_MOVE = False             # False: only SUGGEST categories; True: file confident ones automatically
CLASSIFIER_SUGGEST_MIN = 0.5             # below this confidence, no category suggestion
CLASSIFIER_AUTO_MOVE_MIN = 0.8           # needed for automatic filing (when CLASSIFIER_AUTO_MOVE is True)
CLASSIFIER_DAILY_LIMIT_PER_USER = 200    # cost guard: bookmarks classified per user per 24 hours

# Optional: hide weak matches (0 = identical, ~1 = unrelated), e.g. 0.65
# BOOKMARK_SEARCH_MAX_DISTANCE = 0.65

# Stripe keys (server-side secret only; the public key is the only one the browser may ever see)
STRIPE_SECRET_KEY = _require('STRIPE_SECRET_KEY', min_len=20)
STRIPE_PUBLIC_KEY = os.environ.get('STRIPE_PUBLIC_KEY')
if PRODUCTION and STRIPE_SECRET_KEY and not re.match(r'^(sk|rk)_live_', STRIPE_SECRET_KEY):
    warnings.warn('STRIPE_SECRET_KEY does not look like a LIVE key (sk_live_... / rk_live_...). Payments will not work in production.')
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET')      # whsec_..., needed once webhooks are added

###############################################################################

# Security settings
X_FRAME_OPTIONS = 'DENY'
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
CSRF_COOKIE_SAMESITE = 'Lax'
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024      # reject oversized request bodies (bookmark imports fit comfortably)
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

# HTTPS is ON by default in production. Only for a temporary HTTP-only staging box: ALLOW_INSECURE_HTTP=1 (never on the public site).
# Requires nginx to terminate TLS and send `X-Forwarded-Proto: https` (see nginx/nginx.conf), otherwise you get a redirect loop.
if PRODUCTION and os.environ.get('ALLOW_INSECURE_HTTP') != '1':
    SECURE_SSL_REDIRECT = True
    SECURE_HSTS_SECONDS = int(os.environ.get('HSTS_SECONDS', 31536000))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = os.environ.get('HSTS_PRELOAD') == '1'    # opt in only after every subdomain is HTTPS: preload is very hard to undo
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')


# ---------------------------------------------------------------------------------------------
# Passkeys (WebAuthn). RP ID = the registrable domain ("bukmarkz.com"): passkeys work on it and every subdomain, and
# CANNOT be moved to another domain later without people re-registering, so choose it once. Origins are exact and
# must be https (http://localhost is allowed by browsers for development).
# ---------------------------------------------------------------------------------------------
WEBAUTHN_RP_ID = os.environ.get('WEBAUTHN_RP_ID', '')
WEBAUTHN_RP_NAME = os.environ.get('WEBAUTHN_RP_NAME', 'Bukmarkz')
WEBAUTHN_ORIGINS = [o for o in os.environ.get('WEBAUTHN_ORIGINS', '').split(' ') if o]
# 'required' = the authenticator must check the person (fingerprint, face, PIN). 'preferred' trades a little security for fewer failures on old security keys.
WEBAUTHN_USER_VERIFICATION = os.environ.get('WEBAUTHN_USER_VERIFICATION', 'required')
