# Bukmarkz audit (static analysis; npm/pip registries were unreachable, so nothing was built or run)

Uploaded code is **not Next.js**: BUK_NEW-master = Create React App 3 (React 16, React Router 5, Redux, Bootstrap/Semantic/MUI mix, node-sass 4);
Back-master = Django 3.1 + DRF + Knox + Stripe + SendGrid. There is no /app, /components, /lib or /types, no Supabase client.
(The Next.js + Supabase pieces exist separately in earlier outputs: BukmarkzApp.tsx, ingest*.ts, taxonomy.ts, bukmarkz-django-to-supabase.zip.)

## Frontend (CRA)
- Broken imports (3): Pages/Login/Login.js and Pages/Register/Register.js import `../../redux/actions/old/auth`; Pages/Import/Import.js (commented) points at `../../redux/actions/category`. `src/redux/actions/` does not exist. Login/Register are not imported by App.js, so they are dead files, but they break if ever routed.
- Used but undeclared packages: react-datepicker, date-fns (only in two unused FormControls files), querystring (Authenticate.jsx, Profile.js; resolves via webpack 4 shim today, declare it).
- Declared but unused (16): @material-ui/icons, @syncfusion/*, animate-sass, bootstrap, classnames, payment, react-append-to-body, react-currency-input-field, react-gesture-responder, react-multi-select-component, react-parallax, react-router-transition, react-spring, react-transition-group, @testing-library/user-event.
- Toolchain: node-sass 4 does not install on Node >= 16; react-scripts 3.4 / webpack 4 need `NODE_OPTIONS=--openssl-legacy-provider` on Node 17+.
- Env: .env.development and .env.production are committed, contain a Stripe public key and a Google API key (rotate/restrict the Google key), and production points at plain-HTTP IPs (http://159.65.127.14:1337): mixed-content/no TLS. REACT_APP_GOOGLE_CLIENT_ID is a placeholder. `"proxy"` still targets bukmarkz.herokuapp.com.

## Backend (Django)
- settings.py: `ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS").split(" ")` raises AttributeError when the variable is unset; SECRET_KEY has no fallback (None); DEBUG defaults to ON (`default=1`); CORS whitelist is hard-coded to localhost + one IP.
- Pinned versions are EOL/vulnerable: Django 3.1, Pillow 7.2, cryptography 2.9.2, requests 2.24, urllib3 1.25.10, stripe 2.50.
- AllowAny on subscription/views.py:136 (check that the endpoint is a webhook that verifies Stripe signatures).
- All .py files compile (no syntax errors). No `any`/TypeScript in either project (plain JS).

## Not verifiable here
npm install / react-scripts build / manage.py check / migrations / runtime behaviour.
