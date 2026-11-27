# FILE: BudgetTracker.Service.API/Utils/InvestmentService.py  (NEW file)
"""Investments (Phase 6).

Where the numbers come from
  * Money put in: Saving transactions per savings category, plus the planner for finished
    months that have no transactions (same rule as Debt). Future months are plans, not money.
  * Interest and dividends: the income category linked to each account
    (investment_accounts.income_category_id), with the same rule. Never calculated.
  * Holdings (Stocks, Crypto): investment_trades (opening lots, buys, sells), average cost.
  * Prices: budgets.security_prices (see PriceService).
  * Balances typed in: investment_valuations. A balance is the value at the START of its date;
    entries dated that day or later are added to it (same rule as Debt statements).
    On a Stocks/Crypto account a balance is the uninvested cash only.
  * Moves between accounts: investment_transfers (never counted as new savings).
  * Real estate: value typed in, minus what is left on the linked loan (DebtService) = equity.

Writes only to the investment tables, plus (for a buy with new money or a dividend) one normal
transaction and its planner cell, through the same checks as /saveTransaction.
"""
import re
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

from Utils.DebtService import DebtService
from Utils.PriceService import PriceService
from Utils.RequestUtil import ApiError, parse_amount, parse_client_date, parse_int, parse_text

CENT = Decimal("0.01")
ZERO = Decimal("0")
HOLDINGS_KINDS = ("brokerage", "crypto")
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,19}$")
COINGECKO_ID_RE = re.compile(r"^[a-z0-9][a-z0-9\-]{0,99}$")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
GROUPS = [  # (key, label, kinds) in display order
    ("stocks", "Stocks", ("brokerage",)),
    ("retirement", "401K", ("retirement",)),
    ("cash", "HYSA & savings", ("cash",)),
    ("crypto", "Crypto", ("crypto",)),
    ("hsa", "HSA", ("hsa",)),
    ("property", "Real estate", ("property",)),
    ("other", "Gold & other", ("metal", "other")),
]


def cents(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def money(value):
    return None if value is None else float(cents(value))


def iso(value):
    return value.isoformat() if value else None


def first_of_month(day):
    return date(day.year, day.month, 1)


def month_end(first):
    nxt = date(first.year + 1, 1, 1) if first.month == 12 else date(first.year, first.month + 1, 1)
    return nxt - timedelta(days=1)


def owner_of(user_id):
    return "SJ" if user_id == 2 else "SCP"


def parse_decimal(value, name, places, minimum=None, allow_zero=True):
    if isinstance(value, bool) or value is None or (isinstance(value, str) and not value.strip()):
        raise ApiError(f"{name} must be a number.")
    try:
        number = Decimal(str(value).replace(",", "").replace("$", "").strip())
    except InvalidOperation:
        raise ApiError(f"{name} must be a number.")
    if not number.is_finite():
        raise ApiError(f"{name} must be a number.")
    number = number.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)
    if number < 0 or (not allow_zero and number == 0):
        raise ApiError(f"{name} must be greater than zero." if not allow_zero else f"{name} cannot be negative.")
    return number


def parse_symbol(value, name="symbol"):
    if not isinstance(value, str) or not SYMBOL_RE.match(value.strip().upper()):
        raise ApiError(f"{name} must be a ticker such as VOO or BTC.")
    return value.strip().upper()


class InvestmentService:
    def __init__(self, repo, config=None, today=None):
        self.repo = repo                 # BudgetRepository: for its transaction checks and planner updates
        self.cur = repo.cur
        self.conn = repo.conn
        self.config = config or {}
        self.today = today or date.today()

    # ==================================================================
    # Loading
    # ==================================================================

    def _accounts(self):
        self.cur.execute(
            "SELECT a.category_id, c.name AS account_name, c.user_id, a.kind, a.tracks_holdings, a.institution, "
            "a.income_category_id, a.debt_category_id, ic.name AS income_name "
            "FROM budgets.investment_accounts a "
            "JOIN budgets.categories c ON c.id = a.category_id "
            "LEFT JOIN budgets.categories ic ON ic.id = a.income_category_id "
            "ORDER BY a.category_id"
        )
        keys = ("category_id", "name", "user_id", "kind", "tracks_holdings", "institution",
                "income_category_id", "debt_category_id", "income_name")
        return {r[0]: dict(zip(keys, r)) for r in self.cur.fetchall()}

    def _account(self, category_id, name="category_id"):
        category_id = parse_int(category_id, name, minimum=1)
        account = self._accounts().get(category_id)
        if account is None:
            raise ApiError("That category is not set up as an investment account.", 404)
        return account

    def _flows(self, tx_type, planner_table, category_ids):
        """{category_id: [(date, amount, transaction_id)]} up to today, oldest first.

        Transactions dated today or earlier, plus planner amounts for finished months that have no
        transactions (dated the last day of that month, transaction_id None)."""
        ids = sorted({i for i in category_ids if i})
        if not ids:
            return {}
        self.cur.execute(
            "SELECT category, date, amount, id FROM budgets.transactions "
            "WHERE type = %s AND category = ANY(%s) ORDER BY date, id",
            (tx_type, ids),
        )
        result, logged = {}, set()
        for category, day, amount, tx_id in self.cur.fetchall():
            logged.add((category, first_of_month(day)))
            if day <= self.today:
                result.setdefault(category, []).append((day, Decimal(amount), tx_id))
        self.cur.execute(
            f"SELECT category_id, date_trunc('month', date::timestamp)::date, SUM(amount) FROM {planner_table} "
            "WHERE category_id = ANY(%s) AND date < %s GROUP BY 1, 2 HAVING SUM(amount) <> 0",
            (ids, first_of_month(self.today)),
        )
        for category, month, amount in self.cur.fetchall():
            if (category, month) not in logged:
                result.setdefault(category, []).append((month_end(month), Decimal(amount), None))
        for rows in result.values():
            rows.sort(key=lambda r: (r[0], r[2] is None, r[2] or 0))
        return result

    def _valuations(self):
        """Latest balance per account dated today or earlier: {category_id: (date, value, note)}."""
        self.cur.execute(
            "SELECT DISTINCT ON (category_id) category_id, value_date, value, note "
            "FROM budgets.investment_valuations WHERE value_date <= %s "
            "ORDER BY category_id, value_date DESC",
            (self.today,),
        )
        return {r[0]: (r[1], Decimal(r[2]), r[3]) for r in self.cur.fetchall()}

    def _transfers(self):
        self.cur.execute(
            "SELECT id, transfer_date, from_category_id, to_category_id, amount, note, trade_id "
            "FROM budgets.investment_transfers WHERE transfer_date <= %s ORDER BY transfer_date, id",
            (self.today,),
        )
        keys = ("id", "date", "from", "to", "amount", "note", "trade_id")
        return [dict(zip(keys, r)) for r in self.cur.fetchall()]

    def _trades(self, category_id=None):
        sql = ("SELECT t.id, t.category_id, t.trade_date, t.side, t.symbol, t.quantity, t.price, t.amount, "
               "t.fees, t.funding, t.transaction_id, t.notes, s.name, s.asset_type "
               "FROM budgets.investment_trades t "
               "JOIN budgets.investment_securities s ON s.symbol = t.symbol WHERE t.trade_date <= %s")
        params = [self.today]
        if category_id is not None:
            sql += " AND t.category_id = %s"
            params.append(category_id)
        self.cur.execute(sql + " ORDER BY t.trade_date, t.id", params)
        keys = ("id", "category_id", "date", "side", "symbol", "quantity", "price", "amount", "fees",
                "funding", "transaction_id", "notes", "name", "asset_type")
        return [dict(zip(keys, r)) for r in self.cur.fetchall()]

    def _prices(self):
        return PriceService(self.cur, self.conn, self.config, self.today).latest()

    # ==================================================================
    # Holdings (average cost)
    # ==================================================================

    @staticmethod
    def _positions(trades):
        """{symbol: {quantity, cost, realized, name, asset_type}} from trades in date order."""
        pos = {}
        for t in trades:
            p = pos.setdefault(t["symbol"], {"quantity": ZERO, "cost": ZERO, "realized": ZERO,
                                             "realized_this_year": ZERO, "name": t["name"],
                                             "asset_type": t["asset_type"]})
            qty, amount, fees = Decimal(t["quantity"]), Decimal(t["amount"]), Decimal(t["fees"] or 0)
            if t["side"] in ("opening", "buy"):
                p["quantity"] += qty
                p["cost"] += amount + fees
            else:
                avg = p["cost"] / p["quantity"] if p["quantity"] > 0 else ZERO
                cost_out = avg * min(qty, p["quantity"])
                gain = (amount - fees) - cost_out
                p["realized"] += gain
                p["quantity"] -= qty
                p["cost"] -= cost_out
                if p["quantity"] <= 0:
                    p["quantity"], p["cost"] = ZERO, ZERO
                t["_realized"] = gain
        return pos

    def _holdings_account(self, account, trades, prices, valuation, saving, dividends, transfers):
        """Value, cost and cash of a Stocks/Crypto account."""
        cid = account["category_id"]
        mine = [t for t in trades if t["category_id"] == cid]
        openings = [t for t in mine if t["side"] == "opening"]
        if not mine:
            return None   # holdings not entered yet
        start = min(t["date"] for t in openings) if openings else min(t["date"] for t in mine)
        base_date, cash = start, ZERO
        if valuation and valuation[0] >= start:
            base_date, cash = valuation[0], valuation[1]

        for day, amount, _tx in saving.get(cid, []):
            if day >= base_date and _tx is not None:
                cash += amount
        for day, amount, _tx in dividends.get(account["income_category_id"], []) if account["income_category_id"] else []:
            if day >= base_date and _tx is not None:
                cash += amount
        for tr in transfers:
            if tr["date"] < base_date:
                continue
            if tr["to"] == cid:
                cash += Decimal(tr["amount"])
            if tr["from"] == cid:
                cash -= Decimal(tr["amount"])
        for t in mine:
            if t["side"] == "opening" or t["date"] < base_date:
                continue
            fees = Decimal(t["fees"] or 0)
            cash += (Decimal(t["amount"]) - fees) if t["side"] == "sell" else -(Decimal(t["amount"]) + fees)

        pos = self._positions(mine)
        rows, value, cost, missing = [], ZERO, ZERO, []
        for symbol, p in sorted(pos.items()):
            if p["quantity"] <= 0:
                continue
            price_row = prices.get(symbol)
            price = Decimal(price_row[0]) if price_row else None
            if price is None:
                missing.append(symbol)
            avg = p["cost"] / p["quantity"]
            market = p["quantity"] * (price if price is not None else avg)
            value += market
            cost += p["cost"]
            rows.append({
                "symbol": symbol, "name": p["name"], "asset_type": p["asset_type"],
                "quantity": float(p["quantity"]), "avg_cost": float(avg.quantize(Decimal("0.0001"))),
                "cost": money(p["cost"]), "price": float(price) if price is not None else None,
                "price_date": iso(price_row[1]) if price_row else None,
                "price_source": price_row[2] if price_row else None,
                "value": money(market), "gain": money(market - p["cost"]),
                "gain_pct": round(float((market - p["cost"]) / p["cost"] * 100), 2) if p["cost"] > 0 else None,
            })
        year_start = date(self.today.year, 1, 1)
        realized_year = sum((t.get("_realized", ZERO) for t in mine if t["side"] == "sell" and t["date"] >= year_start), ZERO)
        return {"rows": rows, "value": value + cash, "cost": cost, "cash": cash, "missing_prices": missing,
                "realized_this_year": realized_year, "tracking_since": start}

    # ==================================================================
    # Summary
    # ==================================================================

    def summary(self):
        accounts = self._accounts()
        ids = list(accounts)
        income_ids = [a["income_category_id"] for a in accounts.values() if a["income_category_id"]]
        saving = self._flows("saving", "budgets.savings", ids)
        income = self._flows("income", "budgets.income", income_ids)
        valuations = self._valuations()
        transfers = self._transfers()
        trades = self._trades()
        prices = self._prices()
        loans = self._loans(accounts)
        year_start = date(self.today.year, 1, 1)

        cards, totals = [], {"value": ZERO, "put_in": ZERO, "scp": ZERO, "sj": ZERO}
        for cid, a in accounts.items():
            contributions = saving.get(cid, [])
            put_in_records = sum((x[1] for x in contributions), ZERO)
            t_in = sum((Decimal(t["amount"]) for t in transfers if t["to"] == cid), ZERO)
            t_out = sum((Decimal(t["amount"]) for t in transfers if t["from"] == cid), ZERO)
            inc = income.get(a["income_category_id"], []) if a["income_category_id"] else []
            card = {
                "category_id": cid, "name": a["name"], "owner": owner_of(a["user_id"]), "kind": a["kind"],
                "institution": a["institution"], "tracks_holdings": a["tracks_holdings"],
                "income_category": a["income_name"],
                "income_total": money(sum((x[1] for x in inc), ZERO)),
                "income_this_year": money(sum((x[1] for x in inc if x[0] >= year_start), ZERO)),
                "put_in_records": money(put_in_records),
                "moved_in": money(t_in), "moved_out": money(t_out),
                "estimated": False, "status": "ok", "value": None, "put_in": None, "gain": None,
                "source": None, "as_of": None,
            }
            val = valuations.get(cid)

            if a["kind"] in HOLDINGS_KINDS:
                h = self._holdings_account(a, trades, prices, val, saving, income, transfers)
                if h is None:
                    card.update(status="holdings_needed", estimated=True, value=money(put_in_records),
                                put_in=money(put_in_records), gain=0.0,
                                source="Money put in (add holdings to see the value)")
                else:
                    card.update(value=money(h["value"]), put_in=money(h["cost"] + h["cash"]),
                                gain=money(h["value"] - h["cost"] - h["cash"]), cash=money(h["cash"]),
                                positions=len(h["rows"]), missing_prices=h["missing_prices"],
                                realized_this_year=money(h["realized_this_year"]),
                                source="Holdings × latest prices" + (" + cash" if h["cash"] else ""))
            elif a["kind"] == "property":
                loan = loans.get(a["debt_category_id"]) if a["debt_category_id"] else None
                put_in = put_in_records + t_in - t_out + (loan["principal_paid"] if loan else ZERO)
                card.update(put_in=money(put_in), loan_category=loan["name"] if loan else None,
                            loan_left=money(loan["left"]) if loan else None,
                            loan_set_up=bool(loan and loan["set_up"]))
                if val is None:
                    card.update(status="value_needed", estimated=True, value=None, gain=None,
                                source="Set the property's value")
                else:
                    left = loan["left"] if loan else ZERO
                    equity = val[1] - left
                    card.update(home_value=money(val[1]), value=money(equity), gain=money(equity - put_in),
                                as_of=iso(val[0]), source=f"Value you entered − loan left = equity")
            else:
                put_in = put_in_records + t_in - t_out
                if val is None:
                    est = put_in + (sum((x[1] for x in inc), ZERO) if a["kind"] == "cash" else ZERO)
                    card.update(estimated=True, status="balance_needed" if a["kind"] != "cash" else "ok",
                                value=money(est), put_in=money(put_in), gain=money(est - put_in),
                                source=("Savings + interest you entered" if a["kind"] == "cash"
                                        else "Money put in (set the balance to see growth)"))
                else:
                    vdate, vvalue, note = val
                    after = sum((x[1] for x in contributions if x[0] >= vdate), ZERO)
                    after += sum((x[1] for x in inc if x[0] >= vdate), ZERO)
                    after += sum((Decimal(t["amount"]) for t in transfers if t["to"] == cid and t["date"] >= vdate), ZERO)
                    after -= sum((Decimal(t["amount"]) for t in transfers if t["from"] == cid and t["date"] >= vdate), ZERO)
                    value = vvalue + after
                    if a["kind"] == "cash":
                        # Deposit history may start late; the earnings of a savings account are its interest.
                        earned = sum((x[1] for x in inc), ZERO)
                        put_in = value - earned
                    card.update(value=money(value), put_in=money(put_in), gain=money(value - put_in),
                                as_of=iso(vdate),
                                source=f"Balance {('from ' + note) if note else 'entered'} · {vdate.strftime('%b')} {vdate.day}"
                                       + (" + entries since" if after else ""))
            if card["value"] is not None:
                v = Decimal(str(card["value"]))
                totals["value"] += v
                totals["scp" if card["owner"] == "SCP" else "sj"] += v
            if card["put_in"] is not None and card["value"] is not None:
                totals["put_in"] += Decimal(str(card["put_in"]))
            cards.append(card)

        allocation = []
        for key, label, kinds in GROUPS:
            v = sum((Decimal(str(c["value"])) for c in cards if c["kind"] in kinds and c["value"]), ZERO)
            if v > 0:
                allocation.append({"key": key, "label": label, "value": money(v),
                                   "pct": round(float(v / totals["value"] * 100), 1) if totals["value"] > 0 else 0})

        earned = self.income(self.today.year)
        latest_fetch = max((p[3] for p in prices.values() if p[3]), default=None)
        return {
            "as_of": iso(self.today),
            "totals": {
                "value": money(totals["value"]), "put_in": money(totals["put_in"]),
                "gain": money(totals["value"] - totals["put_in"]),
                "gain_pct": round(float((totals["value"] - totals["put_in"]) / totals["put_in"] * 100), 2)
                if totals["put_in"] > 0 else None,
                "scp": money(totals["scp"]), "sj": money(totals["sj"]),
                "dividends_this_year": earned["totals"]["dividends"],
                "interest_this_year": earned["totals"]["interest"],
                "estimated_accounts": sum(1 for c in cards if c["estimated"]),
            },
            "prices": {"last_fetched": latest_fetch.isoformat(timespec="minutes") if latest_fetch else None,
                       "missing": sorted({s for c in cards for s in c.get("missing_prices", [])})},
            "allocation": allocation,
            "accounts": cards,
        }

    def _loans(self, accounts):
        """{debt_category_id: {left, principal_paid, set_up, name}} for loans linked to a property."""
        linked = {a["debt_category_id"] for a in accounts.values() if a["debt_category_id"]}
        if not linked:
            return {}
        summary = DebtService(self.cur, self.conn, self.today).summary()
        result = {}
        for loan in summary["loans"]:
            if loan["category_id"] in linked:
                set_up = not loan["setup_needed"]
                result[loan["category_id"]] = {
                    "name": loan["category"], "set_up": set_up,
                    "left": Decimal(str(loan.get("balance") or 0)) if set_up else ZERO,
                    "principal_paid": Decimal(str((loan.get("since_opening") or {}).get("principal") or 0)) if set_up else ZERO,
                }
        return result

    # ==================================================================
    # One account's holdings
    # ==================================================================

    def holdings(self, category_id):
        a = self._account(category_id)
        if a["kind"] not in HOLDINGS_KINDS:
            raise ApiError(f"{a['name']} has no holdings; it tracks a balance.")
        cid = a["category_id"]
        saving = self._flows("saving", "budgets.savings", [cid])
        income = self._flows("income", "budgets.income", [a["income_category_id"]])
        trades = self._trades(cid)
        h = self._holdings_account(a, trades, self._prices(), self._valuations().get(cid), saving, income,
                                   self._transfers())
        year_start = date(self.today.year, 1, 1)
        self.cur.execute(
            "SELECT i.symbol, SUM(t.amount) FROM budgets.investment_income i "
            "JOIN budgets.transactions t ON t.id = i.transaction_id "
            "WHERE i.category_id = %s AND t.date >= %s AND t.date <= %s GROUP BY i.symbol",
            (cid, year_start, self.today),
        )
        div = {r[0]: r[1] for r in self.cur.fetchall()}
        rows = h["rows"] if h else []
        for r in rows:
            r["dividends_this_year"] = money(div.get(r["symbol"], ZERO))
        activity = [
            {"id": t["id"], "date": iso(t["date"]), "side": t["side"], "symbol": t["symbol"],
             "quantity": float(t["quantity"]), "price": float(t["price"]), "amount": money(t["amount"]),
             "fees": money(t["fees"]), "funding": t["funding"], "transaction_id": t["transaction_id"],
             "notes": t["notes"]}
            for t in reversed(trades) if t["side"] != "opening"
        ][:25]
        return {
            "category_id": cid, "name": a["name"], "owner": owner_of(a["user_id"]), "kind": a["kind"],
            "holdings_entered": h is not None,
            "rows": rows,
            "cash": money(h["cash"]) if h else 0.0,
            "value": money(h["value"]) if h else None,
            "cost": money(h["cost"]) if h else None,
            "gain": money(h["value"] - h["cost"] - h["cash"]) if h else None,
            "realized_this_year": money(h["realized_this_year"]) if h else 0.0,
            "dividends_this_year": money(sum(div.values(), ZERO)),
            "tracking_since": iso(h["tracking_since"]) if h else None,
            "activity": activity,
        }

    # ==================================================================
    # Dividends and interest (exactly what was entered)
    # ==================================================================

    def income(self, year=None, owner=None):
        """owner: None for everyone, or "SCP" / "SJ" for one person's accounts only."""
        year = parse_int(year if year is not None else self.today.year, "year", minimum=2000, maximum=2100)
        if owner not in (None, "", "SCP", "SJ"):
            raise ApiError("owner must be SCP or SJ.")
        owner = owner or None
        accounts = self._accounts()
        links = {a["income_category_id"]: a for a in accounts.values()
                 if a["income_category_id"] and (owner is None or owner_of(a["user_id"]) == owner)}
        flows = self._flows("income", "budgets.income", list(links))
        months = [{"month": f"{year}-{m:02d}", "label": MONTHS[m - 1], "dividends": ZERO, "interest": ZERO}
                  for m in range(1, 13)]
        by_account, all_time = [], {"dividends": ZERO, "interest": ZERO}
        for income_id, a in links.items():
            kind = "dividends" if a["kind"] in HOLDINGS_KINDS else "interest"
            rows = flows.get(income_id, [])
            in_year = [r for r in rows if r[0].year == year]
            for day, amount, _ in in_year:
                months[day.month - 1][kind] += amount
            all_time[kind] += sum((r[1] for r in rows), ZERO)
            by_account.append({"income_category_id": income_id, "income_category": a["income_name"],
                               "account": a["name"], "account_category_id": a["category_id"],
                               "owner": owner_of(a["user_id"]), "kind": kind,
                               "year_total": money(sum((r[1] for r in in_year), ZERO)),
                               "all_time": money(sum((r[1] for r in rows), ZERO))})
        self.cur.execute(
            "SELECT i.symbol, s.name, SUM(t.amount), "
            "CASE WHEN c.user_id = 2 THEN 'SJ' ELSE 'SCP' END AS owner "
            "FROM budgets.investment_income i "
            "JOIN budgets.transactions t ON t.id = i.transaction_id "
            "JOIN budgets.categories c ON c.id = i.category_id "
            "LEFT JOIN budgets.investment_securities s ON s.symbol = i.symbol "
            "WHERE t.date >= %s AND t.date <= %s GROUP BY i.symbol, s.name, 4 ORDER BY 3 DESC",
            (date(year, 1, 1), min(date(year, 12, 31), self.today)),
        )
        by_symbol = [{"symbol": r[0], "name": r[1], "amount": money(r[2]), "owner": r[3]}
                     for r in self.cur.fetchall() if owner is None or r[3] == owner]
        if owner is None:   # one row per stock when both people hold it
            merged = {}
            for r in by_symbol:
                m = merged.setdefault(r["symbol"], {**r, "amount": 0.0, "owner": r["owner"]})
                m["amount"] = round(m["amount"] + r["amount"], 2)
                if m["owner"] != r["owner"]:
                    m["owner"] = "Both"
            by_symbol = sorted(merged.values(), key=lambda r: -r["amount"])
        div_total = sum((m["dividends"] for m in months), ZERO)
        linked = sum((Decimal(str(s["amount"])) for s in by_symbol), ZERO)
        if div_total - linked > 0:
            by_symbol.append({"symbol": None, "name": "Not linked to a stock", "amount": money(div_total - linked)})
        return {
            "year": year,
            "owner": owner,
            "months": [{**m, "dividends": money(m["dividends"]), "interest": money(m["interest"])} for m in months],
            "by_account": sorted(by_account, key=lambda r: (r["kind"], r["account"])),
            "by_symbol": by_symbol,
            "totals": {"dividends": money(div_total),
                       "interest": money(sum((m["interest"] for m in months), ZERO)),
                       "all_time_dividends": money(all_time["dividends"]),
                       "all_time_interest": money(all_time["interest"])},
        }

    # ==================================================================
    # Lists for the Transactions page
    # ==================================================================

    def options(self):
        """Accounts (for 'money comes from / goes to'), dividend categories, and securities with what
        each holdings account holds (for the sell list)."""
        accounts = self._accounts()
        trades = self._trades()
        held = {}
        for cid in {t["category_id"] for t in trades}:
            for symbol, p in self._positions([t for t in trades if t["category_id"] == cid]).items():
                if p["quantity"] > 0:
                    held.setdefault(cid, []).append({"symbol": symbol, "name": p["name"],
                                                     "quantity": float(p["quantity"]),
                                                     "avg_cost": float((p["cost"] / p["quantity"]).quantize(Decimal("0.0001")))})
        self.cur.execute("SELECT symbol, asset_type, name, quote_id FROM budgets.investment_securities ORDER BY symbol")
        securities = [{"symbol": r[0], "asset_type": r[1], "name": r[2], "quote_id": r[3]} for r in self.cur.fetchall()]
        return {
            "accounts": [{"category_id": a["category_id"], "name": a["name"], "kind": a["kind"],
                          "owner": owner_of(a["user_id"]), "tracks_holdings": a["tracks_holdings"],
                          "income_category_id": a["income_category_id"],
                          "held": held.get(a["category_id"], [])} for a in accounts.values()],
            "dividend_categories": [{"income_category_id": a["income_category_id"], "name": a["income_name"],
                                     "account_category_id": a["category_id"], "account": a["name"]}
                                    for a in accounts.values() if a["income_category_id"] and a["kind"] in HOLDINGS_KINDS],
            "securities": securities,
        }

    # ==================================================================
    # Writing
    # ==================================================================

    def _ensure_security(self, symbol, body):
        self.cur.execute("SELECT asset_type FROM budgets.investment_securities WHERE symbol = %s", (symbol,))
        row = self.cur.fetchone()
        if row is not None:
            return row[0]
        asset_type = body.get("asset_type")
        if asset_type not in ("stock", "etf", "crypto"):
            raise ApiError(f"{symbol} is new: say whether it is a stock, etf or crypto (asset_type).")
        name = parse_text(body.get("name"), "name", 150, required=False) or None
        quote_id = None
        if asset_type == "crypto":
            quote_id = (body.get("quote_id") or "").strip().lower()
            if not COINGECKO_ID_RE.match(quote_id):
                raise ApiError("For a new coin, give its CoinGecko id (quote_id), e.g. bitcoin.")
        self.cur.execute(
            "INSERT INTO budgets.investment_securities (symbol, asset_type, name, quote_id) VALUES (%s, %s, %s, %s)",
            (symbol, asset_type, name, quote_id),
        )
        return asset_type

    def _insert_transaction(self, tx):
        """Same checks and planner update as /saveTransaction, without committing. Returns the new id."""
        t = self.repo._parse_transaction(tx)
        self.cur.execute(
            "INSERT INTO budgets.transactions (user_id, date, type, category, amount, details, created_at, merchant) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (t["paid_by"], t["date"], t["type"], t["category_id"], t["amount"], t["details"], datetime.now(),
             t["merchant"]),
        )
        tx_id = self.cur.fetchone()[0]
        self.repo._set_planner_amount(
            {"income": "budgets.income", "expense": "budgets.expenses", "saving": "budgets.savings",
             "debt": "budgets.debt"}[t["type"]],
            t["category_id"], t["date"].year, t["date"].month, t["amount"], add=True,
        )
        return tx_id, t

    def save_trade(self, body):
        """POST /saveTrade. A buy or sell, plus where the money came from / went, in one step.

        {"category_id": 23, "side": "buy", "symbol": "VOO", "quantity": 2.5, "price": 512.30,
         "fees": 0, "date": "2026-11-22", "notes": "",
         "asset_type"/"name"/"quote_id": only for a symbol seen for the first time,
         buy:  "funding": "new_money" + "transaction": {"paidby": 1, "merchant": "Fidelity", "details": ""}
               | "transfer" + "from_category_id": 25 | "account_cash",
         sell: "destination": "keep" | "transfer" + "to_category_id": 25 | "withdraw"}"""
        if not isinstance(body, dict):
            raise ApiError("trade must be an object.")
        account = self._account(body.get("category_id"))
        if account["kind"] not in HOLDINGS_KINDS:
            raise ApiError(f"{account['name']} does not track shares. Use a Stocks or Crypto account.")
        cid = account["category_id"]
        side = body.get("side")
        if side not in ("buy", "sell"):
            raise ApiError("side must be buy or sell.")
        symbol = parse_symbol(body.get("symbol"))
        quantity = parse_decimal(body.get("quantity"), "quantity", 8, allow_zero=False)
        price = parse_decimal(body.get("price"), "price", 6)
        fees = parse_decimal(body.get("fees") if body.get("fees") not in (None, "") else 0, "fees", 2)
        amount = (parse_amount(body["amount"]) if body.get("amount") not in (None, "")
                  else cents(quantity * price))
        if amount <= 0:
            raise ApiError("The amount must be greater than zero.")
        if body.get("date") is None:
            raise ApiError("Missing field: date.")
        trade_date = parse_client_date(body.get("date"))
        if trade_date > self.today:
            raise ApiError("A trade cannot be dated in the future.")
        notes = parse_text(body.get("notes"), "notes", 255, required=False) or None
        self.cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"investments:{cid}",))
        self._ensure_security(symbol, body)

        tx_id, transfer = None, None
        funding = None
        if side == "buy":
            funding = body.get("funding")
            if funding == "new_money":
                tx = dict(body.get("transaction") or {})
                tx.update({"type": "saving", "category": cid, "amount": str(amount + fees), "date": iso(trade_date)})
                if not tx.get("details"):
                    tx["details"] = f"Buy {quantity.normalize()} {symbol} @ {price.normalize()}"
                tx_id, _t = self._insert_transaction(tx)
            elif funding == "transfer":
                src = self._account(body.get("from_category_id"), "from_category_id")
                if src["category_id"] == cid:
                    raise ApiError("Money cannot move from an account to itself.")
                transfer = (src["category_id"], cid, amount + fees)
            elif funding != "account_cash":
                raise ApiError("funding must be new_money, transfer or account_cash.")
        else:
            held = self._positions([t for t in self._trades(cid) if t["date"] <= trade_date]).get(symbol)
            have = held["quantity"] if held else ZERO
            if quantity > have:
                raise ApiError(f"You hold {have.normalize()} {symbol} in {account['name']} on that date, "
                               f"so you cannot sell {quantity.normalize()}.")
            destination = body.get("destination")
            proceeds = amount - fees
            if destination == "transfer":
                dst = self._account(body.get("to_category_id"), "to_category_id")
                if dst["category_id"] == cid:
                    raise ApiError("Pick a different account to move the cash to.")
                transfer = (cid, dst["category_id"], proceeds)
            elif destination == "withdraw":
                transfer = (cid, None, proceeds)
            elif destination != "keep":
                raise ApiError("destination must be keep, transfer or withdraw.")
            if transfer and proceeds <= 0:
                transfer = None

        self.cur.execute(
            "INSERT INTO budgets.investment_trades "
            "(category_id, trade_date, side, symbol, quantity, price, amount, fees, funding, transaction_id, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (cid, trade_date, side, symbol, quantity, price, amount, fees, funding, tx_id, notes),
        )
        trade_id = self.cur.fetchone()[0]
        if transfer:
            self.cur.execute(
                "INSERT INTO budgets.investment_transfers (transfer_date, from_category_id, to_category_id, amount, note, trade_id) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (trade_date, transfer[0], transfer[1], transfer[2],
                 f"{'Buy' if side == 'buy' else 'Sell'} {symbol}", trade_id),
            )
        self.conn.commit()
        return {"id": trade_id, "transaction_id": tx_id, "amount": money(amount)}

    def delete_trade(self, trade_id):
        """POST /deleteTrade. A buy with new money is removed with its transaction (and planner amount)."""
        trade_id = parse_int(trade_id, "id", minimum=1)
        self.cur.execute("SELECT transaction_id FROM budgets.investment_trades WHERE id = %s", (trade_id,))
        row = self.cur.fetchone()
        if row is None:
            raise ApiError("That trade no longer exists.", 404)
        if row[0]:
            self.repo.delete_transaction(row[0])     # cascades to the trade; commits
        else:
            self.cur.execute("DELETE FROM budgets.investment_trades WHERE id = %s", (trade_id,))
            self.conn.commit()
        return {"deleted": trade_id}

    def save_dividend(self, body):
        """POST /saveDividend. {"transaction": {same fields as /saveTransaction}, "symbol": "VOO"}.
        Saves the income transaction (planner updated as usual) and which stock paid it."""
        if not isinstance(body, dict):
            raise ApiError("Send a JSON object.")
        tx = body.get("transaction")
        if not isinstance(tx, dict):
            raise ApiError("Missing field: transaction.")
        symbol = parse_symbol(body.get("symbol"))
        self.cur.execute("SELECT 1 FROM budgets.investment_securities WHERE symbol = %s", (symbol,))
        if self.cur.fetchone() is None:
            raise ApiError(f"{symbol} is not one of your stocks yet.", 404)
        category = tx.get("category")
        category_id = parse_int(category.get("id") if isinstance(category, dict) else category, "category", minimum=1)
        account = next((a for a in self._accounts().values()
                        if a["income_category_id"] == category_id and a["kind"] in HOLDINGS_KINDS), None)
        if account is None:
            raise ApiError("That category is not a dividends category of a Stocks or Crypto account.")
        tx = {**tx, "type": "income"}
        tx_id, _t = self._insert_transaction(tx)
        self.cur.execute(
            "INSERT INTO budgets.investment_income (transaction_id, symbol, category_id) VALUES (%s, %s, %s)",
            (tx_id, symbol, account["category_id"]),
        )
        self.conn.commit()
        return {"transaction_id": tx_id, "symbol": symbol}

    def save_transfer(self, body):
        """POST /saveTransfer. {"date", "from_category_id", "to_category_id" (null = taken out), "amount", "note"}."""
        if not isinstance(body, dict):
            raise ApiError("Send a JSON object.")
        src = self._account(body.get("from_category_id"), "from_category_id")
        dst = None
        if body.get("to_category_id") not in (None, ""):
            dst = self._account(body.get("to_category_id"), "to_category_id")
            if dst["category_id"] == src["category_id"]:
                raise ApiError("Pick two different accounts.")
        amount = parse_amount(body.get("amount"))
        if amount <= 0:
            raise ApiError("amount must be greater than zero.")
        if body.get("date") is None:
            raise ApiError("Missing field: date.")
        day = parse_client_date(body.get("date"))
        if day > self.today:
            raise ApiError("A move cannot be dated in the future.")
        note = parse_text(body.get("note"), "note", 255, required=False) or None
        self.cur.execute(
            "INSERT INTO budgets.investment_transfers (transfer_date, from_category_id, to_category_id, amount, note) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (day, src["category_id"], dst["category_id"] if dst else None, amount, note),
        )
        new_id = self.cur.fetchone()[0]
        self.conn.commit()
        return {"id": new_id}

    def delete_transfer(self, transfer_id):
        transfer_id = parse_int(transfer_id, "id", minimum=1)
        self.cur.execute("SELECT trade_id FROM budgets.investment_transfers WHERE id = %s", (transfer_id,))
        row = self.cur.fetchone()
        if row is None:
            raise ApiError("That move no longer exists.", 404)
        if row[0]:
            raise ApiError("This move belongs to a trade; delete the trade instead.")
        self.cur.execute("DELETE FROM budgets.investment_transfers WHERE id = %s", (transfer_id,))
        self.conn.commit()
        return {"deleted": transfer_id}

    def save_valuation(self, body):
        """POST /saveValuation. {"category_id", "date", "value", "note"}: a balance from an app or statement.
        On a Stocks/Crypto account it is the uninvested cash."""
        if not isinstance(body, dict):
            raise ApiError("Send a JSON object.")
        account = self._account(body.get("category_id"))
        if body.get("date") is None:
            raise ApiError("Missing field: date.")
        day = parse_client_date(body.get("date"))
        if day > self.today:
            raise ApiError("A balance cannot be dated in the future.")
        value = parse_decimal(body.get("value"), "value", 2)
        note = parse_text(body.get("note"), "note", 255, required=False) or None
        self.cur.execute(
            "INSERT INTO budgets.investment_valuations (category_id, value_date, value, note) VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (category_id, value_date) DO UPDATE SET value = EXCLUDED.value, note = EXCLUDED.note",
            (account["category_id"], day, value, note),
        )
        self.conn.commit()
        return {"category_id": account["category_id"], "date": iso(day), "value": money(value)}

    def refresh_prices(self, force=False):
        return PriceService(self.cur, self.conn, self.config, self.today).refresh(force=bool(force))

    def save_price(self, body):
        if not isinstance(body, dict):
            raise ApiError("Send a JSON object.")
        symbol = parse_symbol(body.get("symbol"))
        self.cur.execute("SELECT 1 FROM budgets.investment_securities WHERE symbol = %s", (symbol,))
        if self.cur.fetchone() is None:
            raise ApiError(f"{symbol} is not one of your holdings.", 404)
        price = parse_decimal(body.get("price"), "price", 6, allow_zero=False)
        PriceService(self.cur, self.conn, self.config, self.today).save_manual(symbol, price)
        return {"symbol": symbol, "price": float(price)}
