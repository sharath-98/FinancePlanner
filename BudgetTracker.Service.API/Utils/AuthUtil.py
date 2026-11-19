# FILE: BudgetTracker.Service.API/Utils/AuthUtil.py  (NEW file)
"""Password hashing, login tokens and a failed-login limiter. Standard library only.

A stored hash looks like  scrypt$<n>$<r>$<p>$<salt>$<hash>  (salt and hash in base64),
so the settings used are kept with each password and can be raised later.
"""
import base64
import hashlib
import hmac
import json
import os
import secrets
import time

_N, _R, _P = 2 ** 14, 8, 1
_KEY_LENGTH = 32
MIN_PASSWORD_LENGTH = 10


def _b64(raw):
    return base64.b64encode(raw).decode('ascii')


def _derive(password, salt, n, r, p):
    return hashlib.scrypt(password.encode('utf-8'), salt=salt, n=n, r=r, p=p, dklen=_KEY_LENGTH)


def hash_password(password):
    """Returns the text to store in budgets.users.password_hash."""
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    salt = secrets.token_bytes(16)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(_derive(password, salt, _N, _R, _P))}"


def verify_password(password, stored):
    """True only if the password matches the stored hash. Never raises on bad input."""
    try:
        scheme, n, r, p, salt, expected = stored.split('$')
        if scheme != 'scrypt' or not isinstance(password, str):
            return False
        actual = _derive(password, base64.b64decode(salt), int(n), int(r), int(p))
        return hmac.compare_digest(actual, base64.b64decode(expected))
    except Exception:
        return False


# Checked when the username does not exist, so a wrong user and a wrong password take equally long.
DUMMY_HASH = hash_password("not-a-real-password")


# ----------------------------------------------------------------------
# Signed login tokens (a small signed note: who, and until when)
# ----------------------------------------------------------------------

def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def _unb64url(text):
    return base64.urlsafe_b64decode(text + '=' * (-len(text) % 4))


def _sign(body, secret):
    return _b64url(hmac.new(secret.encode('utf-8'), body.encode('ascii'), hashlib.sha256).digest())


def create_token(user_id, username, secret, days, now=None):
    """Returns (token, expiry as a unix time)."""
    expires = int((time.time() if now is None else now) + days * 86400)
    body = _b64url(json.dumps({'uid': user_id, 'u': username, 'exp': expires}, separators=(',', ':')).encode('utf-8'))
    return f"{body}.{_sign(body, secret)}", expires


def read_token(token, secret, now=None):
    """The token's contents if it is genuine and not expired, otherwise None."""
    try:
        body, signature = token.split('.')
        if not hmac.compare_digest(signature, _sign(body, secret)):
            return None
        payload = json.loads(_unb64url(body))
        if payload['exp'] <= (time.time() if now is None else now):
            return None
        if not isinstance(payload['uid'], int) or not isinstance(payload['u'], str):
            return None
        return payload
    except Exception:
        return None


def load_or_create_secret(configured=None, path='auth_secret.key'):
    """The key that signs tokens.

    Taken from appsettings.json ("auth_secret") if set there; otherwise from the file
    auth_secret.key, which is created on first start. Keep that file private and out of git.
    Replacing it signs everyone out.
    """
    if configured:
        if len(configured) < 32:
            raise ValueError("auth_secret in appsettings.json must be at least 32 characters.")
        return configured
    if os.path.exists(path):
        with open(path) as handle:
            existing = handle.read().strip()
        if len(existing) >= 32:
            return existing
    secret = secrets.token_hex(32)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as handle:
        handle.write(secret)
    return secret


# ----------------------------------------------------------------------
# Failed-login limiter (kept in memory; resets when the API restarts)
# ----------------------------------------------------------------------

class LoginThrottle:
    """After max_failures wrong passwords for a username within window seconds, block it for that window."""

    def __init__(self, max_failures=5, window=300):
        self.max_failures = max_failures
        self.window = window
        self._failures = {}

    def _recent(self, key, now):
        recent = [t for t in self._failures.get(key, []) if now - t < self.window]
        self._failures[key] = recent
        return recent

    def is_blocked(self, key, now=None):
        now = time.time() if now is None else now
        return len(self._recent(key, now)) >= self.max_failures

    def record_failure(self, key, now=None):
        now = time.time() if now is None else now
        self._recent(key, now).append(now)

    def clear(self, key):
        self._failures.pop(key, None)