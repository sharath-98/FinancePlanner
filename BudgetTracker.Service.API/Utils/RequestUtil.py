# FILE: BudgetTracker.Service.API/Utils/RequestUtil.py  (NEW file)
"""Helpers for reading and checking what the UI sends.

Anything wrong with the input raises ApiError. app.py turns that into a JSON
answer such as {"error": "year must be a whole number."} with HTTP status 400,
so the UI can show a clear message instead of a crash.
"""
import calendar
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from flask import request

# ['Jan', 'Feb', ..., 'Dec'] whatever language the computer is set to
MONTHS = list(calendar.month_abbr)[1:]


class ApiError(Exception):
    """A mistake the caller can fix (bad input, unknown category, ...)."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def json_body():
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ApiError("Send a JSON object in the request body.")
    return body


def require_field(body, name):
    if not isinstance(body, dict) or body.get(name) is None:
        raise ApiError(f"Missing field: {name}.")
    return body[name]


def parse_int(value, name, minimum=None, maximum=None):
    if isinstance(value, bool) or value is None:
        raise ApiError(f"{name} must be a whole number.")
    try:
        if isinstance(value, float) and not value.is_integer():
            raise ValueError
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        raise ApiError(f"{name} must be a whole number.")
    if (minimum is not None and number < minimum) or (maximum is not None and number > maximum):
        raise ApiError(f"{name} is out of range.")
    return number


def parse_year(value, name="year"):
    return parse_int(value, name, minimum=1900, maximum=2200)


def parse_amount(value, name="amount"):
    """Money as a Decimal with two decimals (never a float)."""
    if isinstance(value, bool) or value is None:
        raise ApiError(f"{name} must be a number.")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ApiError(f"{name} must be a number.")
    if not number.is_finite() or abs(number) >= Decimal("1e10"):
        raise ApiError(f"{name} must be a number below 10 billion.")
    return number.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def parse_text(value, name, max_length, required=True):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ApiError(f"{name} must be text.")
    text = value.strip()
    if "\x00" in text:
        raise ApiError(f"{name} contains a character that cannot be stored.")
    if required and not text:
        raise ApiError(f"{name} is required.")
    if len(text) > max_length:
        raise ApiError(f"{name} can be at most {max_length} characters.")
    return text


def parse_client_date(value, name="date"):
    """Accepts 2026-11-19 or a full timestamp such as 2026-11-19T05:00:00.000Z.

    A timestamp keeps the calendar date it was written with, which is what the
    API has always stored.
    """
    if not isinstance(value, str) or not value.strip():
        raise ApiError(f"{name} must be a date such as 2026-11-19.")
    text = value.strip()
    try:
        if len(text) == 10:
            return date.fromisoformat(text)
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        raise ApiError(f"{name} must be a date such as 2026-11-19.")


def month_bounds(year, month):
    """First day of the month and first day of the next month."""
    start = date(year, month, 1)
    following = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    return start, following