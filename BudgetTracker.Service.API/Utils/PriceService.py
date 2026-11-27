# FILE: BudgetTracker.Service.API/Utils/PriceService.py  (NEW file)
"""Latest prices for stocks/ETFs (Finnhub) and coins (CoinGecko), cached in budgets.security_prices.

Uses only Python's standard library (urllib), so no new package is needed.

API keys (NOT in appsettings.json: that file is committed to GitHub). Put them in
BudgetTracker.Service.API/secrets.json, which git ignores:
    {"finnhub_api_key": "<your key>", "coingecko_api_key": "<optional demo key>"}
or in the environment variables FINNHUB_API_KEY / COINGECKO_API_KEY.
appsettings.json may still hold "price_cooldown_minutes": 5 (a symbol fetched more recently is skipped).

A failed lookup never removes a price: the last one stays, with its date.
"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

FINNHUB_QUOTE_URL = "https://finnhub.io/api/v1/quote"
COINGECKO_PRICE_URL = "https://api.coingecko.com/api/v3/simple/price"
TIMEOUT_SECONDS = 8
FINNHUB_PAUSE_SECONDS = 1.1   # stays under the free plan's 60 calls a minute
DEFAULT_COOLDOWN_MINUTES = 5


def _get_json(url, headers=None):
    request = urllib.request.Request(url, headers={"Accept": "application/json", **(headers or {})})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


SECRETS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "secrets.json")


def _secret(name, config):
    """Environment variable, then secrets.json (git-ignored), then the passed config."""
    value = os.environ.get(name.upper())
    if not value and os.path.exists(SECRETS_FILE):
        try:
            with open(SECRETS_FILE) as f:
                value = (json.load(f) or {}).get(name)
        except (OSError, ValueError):
            value = None
    return (value or config.get(name) or "").strip()


def _price(value):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return number if number.is_finite() and number > 0 else None


class PriceService:
    def __init__(self, cur, conn, config, today=None, fetch_json=None, sleep=time.sleep):
        self.cur = cur
        self.conn = conn
        self.finnhub_key = _secret("finnhub_api_key", config)
        self.coingecko_key = _secret("coingecko_api_key", config)
        self.cooldown = timedelta(minutes=int(config.get("price_cooldown_minutes", DEFAULT_COOLDOWN_MINUTES)))
        self.today = today or date.today()
        self.fetch_json = fetch_json or _get_json
        self.sleep = sleep

    # ---------- reading ----------

    def latest(self, symbols=None):
        """{symbol: (price, price_date, source, fetched_at)} with the newest price per symbol."""
        sql = ("SELECT DISTINCT ON (symbol) symbol, price, price_date, source, fetched_at "
               "FROM budgets.security_prices")
        params = ()
        if symbols:
            sql += " WHERE symbol = ANY(%s)"
            params = (list(symbols),)
        self.cur.execute(sql + " ORDER BY symbol, price_date DESC, fetched_at DESC", params)
        return {r[0]: (r[1], r[2], r[3], r[4]) for r in self.cur.fetchall()}

    def held_symbols(self):
        """Symbols held in any account today (shares above zero), with their type and CoinGecko id."""
        self.cur.execute(
            "SELECT s.symbol, s.asset_type, s.quote_id "
            "FROM budgets.investment_trades t JOIN budgets.investment_securities s ON s.symbol = t.symbol "
            "WHERE t.trade_date <= %s "
            "GROUP BY s.symbol, s.asset_type, s.quote_id "
            "HAVING SUM(CASE WHEN t.side = 'sell' THEN -t.quantity ELSE t.quantity END) > 0 "
            "ORDER BY s.symbol",
            (self.today,),
        )
        return self.cur.fetchall()

    # ---------- fetching ----------

    def refresh(self, force=False):
        """Fetches prices for everything held. Returns what was updated, skipped and failed.

        Symbols fetched within the cooldown are skipped unless force=True."""
        held = self.held_symbols()
        latest = self.latest([s for s, _t, _q in held])
        now = datetime.now()

        def due(symbol):
            last = latest.get(symbol)
            return force or last is None or last[3] is None or now - last[3] >= self.cooldown

        stocks = [s for s, kind, _q in held if kind in ("stock", "etf") and due(s)]
        coins = [(s, q) for s, kind, q in held if kind == "crypto" and due(s)]
        skipped = [s for s, _k, _q in held if not due(s)]
        updated, failed = {}, {}

        if stocks and not self.finnhub_key:
            for s in stocks:
                failed[s] = "No Finnhub key: add finnhub_api_key to secrets.json."
            stocks = []
        for i, symbol in enumerate(stocks):
            if i:
                self.sleep(FINNHUB_PAUSE_SECONDS)
            try:
                data = self.fetch_json(
                    FINNHUB_QUOTE_URL + "?" + urllib.parse.urlencode({"symbol": symbol, "token": self.finnhub_key})
                )
                price = _price((data or {}).get("c"))
                if price is None:
                    failed[symbol] = "Finnhub has no price for this symbol."
                else:
                    updated[symbol] = (price, "finnhub")
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as err:
                failed[symbol] = f"Finnhub did not answer ({err.__class__.__name__})."

        missing_ids = [s for s, q in coins if not q]
        for s in missing_ids:
            failed[s] = "No CoinGecko id (quote_id) saved for this coin."
        ids = {q.lower(): s for s, q in coins if q}
        if ids:
            headers = {"x-cg-demo-api-key": self.coingecko_key} if self.coingecko_key else None
            try:
                data = self.fetch_json(
                    COINGECKO_PRICE_URL + "?" + urllib.parse.urlencode(
                        {"ids": ",".join(sorted(ids)), "vs_currencies": "usd"}),
                    headers,
                ) or {}
                for coin_id, symbol in ids.items():
                    price = _price((data.get(coin_id) or {}).get("usd"))
                    if price is None:
                        failed[symbol] = "CoinGecko has no price for this id."
                    else:
                        updated[symbol] = (price, "coingecko")
            except (urllib.error.URLError, TimeoutError, ValueError, OSError) as err:
                for symbol in ids.values():
                    failed[symbol] = f"CoinGecko did not answer ({err.__class__.__name__})."

        for symbol, (price, source) in updated.items():
            self._store(symbol, price, source)
        self.conn.commit()
        return {
            "updated": sorted(updated),
            "skipped_recent": sorted(skipped),
            "failed": [{"symbol": s, "reason": r} for s, r in sorted(failed.items())],
            "as_of": now.isoformat(timespec="seconds"),
        }

    def save_manual(self, symbol, price, price_date=None):
        """A price typed in by hand (used when a lookup fails)."""
        self._store(symbol, price, "manual", price_date)
        self.conn.commit()

    def _store(self, symbol, price, source, price_date=None):
        self.cur.execute(
            "INSERT INTO budgets.security_prices (symbol, price_date, price, source, fetched_at) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (symbol, price_date) "
            "DO UPDATE SET price = EXCLUDED.price, source = EXCLUDED.source, fetched_at = EXCLUDED.fetched_at",
            (symbol, price_date or self.today, price, source, datetime.now()),
        )
