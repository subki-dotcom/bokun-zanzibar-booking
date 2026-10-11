# Admin and staff password recovery

`POST /api/auth/forgot-password` accepts `{ "email": "..." }`. Active users receive a single-use email link valid for 30 minutes. Unknown, inactive and throttled accounts receive the same public response. Requests are limited per IP (10 per 15 minutes) and per account (one email per minute). Provider failures produce the same public response and a sanitized server log; no reset link is returned through the API.

`POST /api/auth/reset-password` accepts `{ "token": "...", "password": "..." }`. Passwords must contain at least 12 characters and fit bcrypt's 72-byte UTF-8 limit. An atomic update consumes the hashed reset token, changes the password and increments the account token version, invalidating old login sessions. No booking or financial collections are modified.

## Deployment prerequisites

- Deploy both the authentication backend changes and frontend recovery pages. This is not a frontend-only feature. Do not trigger deployment without approval.
- Existing Resend email configuration must be enabled: `EMAIL_ENABLED=true`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and a verified `EMAIL_FROM` sender.
- `PASSWORD_RESET_SITE_URL` defaults to `https://zanzibartoursandsafaris.co.tz`. It must be a trusted HTTPS origin. Never derive it from request headers. It does not change payment callback configuration or `FRONTEND_URL`.
- Users must have access to the email address already registered to their account. Changing the website domain does not change their login email. No alternative email or unauthenticated recovery bypass is provided.
- Recovery pages are noindex and are outside the public analytics layout. Tokens are passed in the URL fragment, cleared from the address bar after opening, and sent only in a POST body. Do not enable request-body logging on these endpoints. Refreshing the reset page requires reopening the original email link.
- Existing users need no migration. Reset fields are added on request; legacy login tokens use version zero until the first reset.
- Rate limits per IP use process memory. The persisted account cooldown also applies across instances. Use a shared limiter store if running multiple API replicas at significant scale.

Verify with a controlled account and inbox after deployment: request link, set password, log in, reject reuse/expired link, and verify old sessions are rejected. Never expose passwords or reset links in logs or tickets.
