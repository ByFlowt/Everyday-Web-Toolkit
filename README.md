# Everyday Web Toolkit

A small static dashboard with a login screen, a language converter, and a time calculator.

## How the login works

This project does **not** store passwords inside the HTML files directly.
Instead, the GitHub Actions workflow builds `index.html` during deployment and injects the secret values from GitHub Secrets.

### Secret setup in GitHub

Go to:

`Repository` -> `Settings` -> `Secrets and variables` -> `Actions`

Create these secrets:

- `USER_TOBIAS` = Tobias's password
- `USER_LUCAS` = Lucas's password
- `USER_LEEONIE` = Leeonie's password
- `RECOVERY_CODE` = admin recovery code

The recovery code is one shared admin value, not one code per user.
It only authorizes password resets in the recovery panel.

### Important note about "plain text"

You can type the password value into the GitHub Secret field as normal text.
That is fine because the value is stored as a secret in GitHub and not committed into the repository.

Do **not** write passwords directly in `index.html` or `deploy.yml`.

## Recovery flow

If a password needs to be changed:

1. Update the matching GitHub Secret.
2. Push the change or rerun the deployment workflow.
3. The workflow rebuilds the page with the new password value.

The recovery panel is reset-only now.
It does **not** show or download the current password.
Use it to set a new password for the selected user when you know the recovery code.

If you forgot the admin recovery code, you must update it in GitHub Secrets too.

## Auto logout

The dashboard stores only the login state in `localStorage`:

- `isAuth`
- `userName`
- `lastActivity`

If the session is inactive for too long, the page logs out automatically.

## File overview

- `index.html` - login page and dashboard
- `.github/workflows/deploy.yml` - secret injection during GitHub Pages deployment
- `Converter.html` - converter tool
- `TimeCalculator.html` - time calculator tool

## Local use

This project is designed for GitHub Pages deployment. If you open the HTML files locally, the login secrets will not be injected unless you manually replace the placeholders.
