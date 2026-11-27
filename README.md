# Everyday Web Toolkit

A small static site for GitHub Pages: a login page with a dashboard, a Gemini-powered text restyler and an end-of-workday calculator. The UI is German. It is plain HTML, CSS and JavaScript (Material 3 Expressive look) with no npm dependencies.

> **Rotate old credentials.** Earlier versions published passwords and a recovery code. Treat every one of them as leaked: replace each with a new value, and change it anywhere else it was reused. Removing a file or redeploying does not remove it from Git history or from copies others may have made.

## Setup

1. In the repository, set **Settings > Pages > Source** to **GitHub Actions**.
2. Add secrets under **Settings > Secrets and variables > Actions** (repository secrets, or secrets of the `github-pages` environment).
3. Push to `main`, or run the **Test and deploy** workflow manually on `main`.

| Secret | Content |
| --- | --- |
| `USERS` | JSON object mapping user names to passwords: `{"<name>": "<password>"}` |
| `USER_TOBIAS` | Password for the user `Tobias` |
| `USER_LUCAS` | Password for the user `Lucas` |
| `USER_LEEONIE` | Password for the user `Leeonie` |

- You need at least one user. Each secret is optional on its own.
- A `USER_*` secret overrides the `USERS` entry with the same name, ignoring case.
- In `USERS`, the user name is the key and the password is the value. Names are published. They may have up to 40 characters: letters, digits, spaces and `. _ - '`. These checks cannot catch every swapped pair, so check the order.
- **Recommended:** store the secrets as secrets of the `github-pages` environment, restrict that environment's deployment branches to `main`, and remove the repository-level copies. Otherwise anyone with write access can read repository secrets through a workflow on any branch.
- **Every password needs at least 12 characters.** Leading and trailing spaces are ignored. User names ignore case.
- `RECOVERY_CODE` is no longer used. **Delete that secret.** The password reset panel has been removed.

The build fails if there are no users, `USERS` is not a JSON object with non-empty string values, a name is not allowed, two names differ only in case, or a password is too short. Error messages identify `USERS` entries by position (`USERS entry #1`) and never quote them.

**Changing a password:** update the secret, then re-run the workflow on `main` (secret changes alone do not trigger a deployment). Existing sessions are not ended by this; they expire on logout or after 60 minutes of inactivity.

## Gemini API key

The converter asks each user for their own key. In Google Cloud or AI Studio, restrict it to:

- the **Gemini API** (Generative Language API), and
- the HTTP referrer of the site's **origin**, for example `https://<account>.github.io/*`. The pages use the referrer policy `strict-origin-when-cross-origin`, so Google receives only the origin. A restriction that includes the repository path will reject every request. Note that all sites on that origin pass the restriction.

The key is kept in `sessionStorage` (this tab only) unless "Auf diesem Gerät merken" is switched on, which uses `localStorage`. Logout and session expiry delete it, with two limits:

- Expiry is only noticed when one of the pages runs. After the browser is closed, a remembered key **stays on disk** until one of the pages is opened in that browser again. On shared devices, log out or use "Key löschen".
- A tab-only copy can only be deleted by its own tab. A tab that has left these pages keeps it until it is closed or shows one of them while no one, or a different user, is signed in. If the same user has signed in again before the tab returns, the key is restored.

Changing or removing the remembered key in one tab also drops the tab-only copy in other open tabs.

Text you convert is sent to Google. The model ID is the constant `GEMINI_MODEL` in `assets/js/gemini.js`. To discourage password managers from filling or saving the key, the key field is a text field masked with CSS. Browsers without that masking get a password field with `autocomplete="new-password"` instead, where a password manager may still offer to generate or save a password.

The calculator keeps its inputs in `localStorage`, separately for each user name, also after logout. The first user who opens it takes over the inputs saved by earlier versions. This only separates what the UI shows. **It is not access control.**

## Local use

Requires Node.js 22 or newer (CI uses 24). The pages must be served over HTTP; opening the files directly does not work. Use throwaway test passwords.

PowerShell:

```powershell
$env:USERS = '{"Test": "<a throwaway password of 12+ characters>"}'
npm run build
npm run serve
```

Bash:

```bash
USERS='{"Test": "<a throwaway password of 12+ characters>"}' npm run build
npm run serve
```

Then open <http://127.0.0.1:8080/> (set `PORT` to change the port). The server only serves `_site/`.

Run the tests with `npm test`.

## Security model

**This login is only a soft, client-side gate. It is not access control.**

- Every published file can be downloaded by anyone. Visiting a tool page directly with JavaScript changes, or setting the session values in developer tools, bypasses the login. Never put confidential content into this site.
- The build publishes salted PBKDF2-HMAC-SHA256 hashes (600,000 iterations), not passwords. Anyone can download them, together with the user names, and guess passwords offline. Use **long, random, unique** passwords, for example from a password manager. The 12-character minimum alone does not make a guessable password safe.
- The 60-minute inactivity timeout protects shared devices from casual reuse, nothing more.
- Browser storage belongs to the origin, not to this site. All project sites under `<account>.github.io` **share one origin**, so their pages can read a remembered API key and the calculator inputs. A tab-only key in `sessionStorage` is also readable by any other page of that origin that is opened in the same tab. Only publish sites you trust under that account, or give this site its own domain.
- Each page sets a Content Security Policy through a `<meta>` tag and loads no third-party scripts. Fonts and icons come from Google Fonts. GitHub Pages cannot send custom headers, so header-only protections such as `frame-ancestors` are not available.

If you need real access control, check access on a server before any file is delivered, for example with [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) in front of a host you control. The unprotected GitHub Pages copy must then be switched off.

## Layout

- `index.html`, `Converter.html`, `TimeCalculator.html`: the three pages
- `assets/css/theme.css`: design tokens and shared components; one small stylesheet per page
- `assets/js/session.js`, `session-guard.js`: session rules and their page wiring (classic scripts loaded in `<head>`)
- `assets/js/auth.js`, `gemini.js`, `key-store.js`, `time-calc.js`: logic without DOM lookups
- `assets/js/secret-field.js`: the masked API key field
- `assets/js/login.js`, `converter.js`, `calculator.js`: page scripts
- `assets/js/users.js`: empty placeholder; the build writes the hashes into the `_site/` copy
- `scripts/build.mjs` copies the pages and `assets/` into `_site/`; `scripts/serve.mjs` previews it
- `.github/workflows/deploy.yml`: tests on every push to `main` and pull request; deploys from `main` only
