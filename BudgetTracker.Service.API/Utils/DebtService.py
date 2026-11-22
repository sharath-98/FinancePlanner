# FILE: BudgetTracker.Service.API/Utils/DebtService.py  (NEW file)
"""Debt payoff tracking (Phase 5).

Where the numbers come from
  * Payments: budgets.transactions with type = 'debt', plus the debt planner table
    (budgets.debt) for past months that have no logged transactions (see _payments).
  * Loan facts: budgets.debt_accounts (one row per debt category: rate, opening balance, ...).
  * Corrections: budgets.debt_balance_snapshots (a balance copied from a lender statement).

How the balance is estimated
  Start from the opening balance. Interest accrues daily (APR / 365) on what is owed.
  Each payment pays the interest accrued so far first, the rest reduces the principal.
  A statement balance replaces the estimate at the start of its date (payments dated that
  same day still come off it), and the difference is reported as the "correction".

  Payments dated after today are "scheduled": they are listed but not subtracted yet.

Nothing here touches the existing tables or endpoints; the only writes are to the two new tables.
"""
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from statistics import median

from Utils.RequestUtil import ApiError, parse_amount, parse_client_date, parse_int, parse_text

CENT = Decimal('0.01')
ZERO = Decimal('0')
DAYS_PER_YEAR = Decimal('365')
MAX_PROJECTION_MONTHS = 600          # 50 years; past this a loan is reported as "not paying off"
RECENT_PAYMENT_MONTHS = 3            # used for the monthly payment when the account has none saved
PLANNER_MERCHANT = 'Debt planner (no transactions logged)'
MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

ACCOUNT_COLUMNS = (
    "a.id, a.category_id, c.name, a.lender, a.original_amount, a.start_date, a.interest_rate, "
    "a.term_months, a.monthly_payment, a.opening_balance, a.opening_balance_date, a.closed_date, a.notes"
)


# ----------------------------------------------------------------------
# Small helpers
# ----------------------------------------------------------------------

def cents(value):
    return Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP)


def money(value):
    return None if value is None else float(cents(value))


def iso(value):
    return value.isoformat() if value else None


def first_of_month(day):
    return date(day.year, day.month, 1)


def shift_months(first, count):
    index = first.year * 12 + (first.month - 1) + count
    return date(index // 12, index % 12 + 1, 1)


def month_key(first):
    return f"{first.year}-{first.month:02d}"


def month_label(first):
    return f"{MONTH_NAMES[first.month - 1]}-{first.year}"


def parse_rate(value, name="interest_rate"):
    """APR in percent with up to three decimals (6.875 stays 6.875)."""
    if isinstance(value, bool) or value is None:
        raise ApiError(f"{name} must be a number.")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ApiError(f"{name} must be a number.")
    if not number.is_finite() or number < 0 or number >= 100:
        raise ApiError(f"{name} must be a percentage between 0 and 100.")
    return number.quantize(Decimal('0.001'), rounding=ROUND_HALF_UP)


def optional(body, key, parser, *args, **kwargs):
    value = body.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    return parser(value, key, *args, **kwargs)


# ----------------------------------------------------------------------
# The calculations (pure functions: no database, easy to test)
# ----------------------------------------------------------------------

def simulate(opening_date, opening_balance, rate_pct, payments, snapshots, until):
    """Walks a loan forward from its opening balance.

    payments:  [(date, amount, id, merchant)] dated after opening_date, oldest first
    snapshots: [(date, balance)] dated after opening_date, oldest first
    until:     stop here (today); later payments are ignored

    Returns {"events": [...], "principal": Decimal, "accrued": Decimal}. Each event is a
    payment (with its interest/principal split) or a statement (with its correction).
    On the same day a statement comes before payments: a balance copied from the lender's
    app or statement is the balance at the START of that day, so a payment logged with the
    same date is subtracted from it. (Lender apps usually show a payment a day or two late.)
    The opening balance is different: it is the balance at the end of its day.
    """
    daily_rate = Decimal(rate_pct) / Decimal(100) / DAYS_PER_YEAR
    principal, accrued, last = Decimal(opening_balance), ZERO, opening_date
    # (date, order on that date, kind, item): statements (order 0) before payments (order 1)
    timeline = [(p[0], 1, 0, p) for p in payments if opening_date < p[0] <= until]
    timeline += [(s[0], 0, 1, s) for s in snapshots if opening_date < s[0] <= until]
    timeline.sort(key=lambda item: (item[0], item[1]))
    events = []

    def accrue_to(day):
        nonlocal accrued, last
        if day > last:
            accrued += principal * daily_rate * (day - last).days
            last = day

    for day, _order, kind, item in timeline:
        accrue_to(day)
        if kind == 0:
            amount = Decimal(item[1])
            interest = min(cents(accrued), amount)
            to_principal = amount - interest
            accrued = max(accrued - interest, ZERO)
            overpaid = max(to_principal - principal, ZERO)
            principal = max(principal - to_principal, ZERO)
            events.append({
                "kind": "payment", "date": day, "id": item[2], "merchant": item[3], "amount": amount,
                "interest": interest, "principal": to_principal - overpaid, "overpaid": overpaid,
                "balance_after": principal + accrued,
            })
        else:
            estimated = principal + accrued
            principal, accrued = Decimal(item[1]), ZERO
            events.append({
                "kind": "statement", "date": day, "balance": principal,
                "estimated": estimated, "correction": principal - estimated,
            })

    accrue_to(until)
    return {"events": events, "principal": principal, "accrued": accrued}


def project(balance, rate_pct, monthly_payment, first_month, extra_monthly=ZERO, lump_sum=ZERO):
    """Month-by-month payoff from today's balance with a fixed payment (monthly compounding).

    Returns months to payoff, the payoff month, interest still to pay and total still to pay.
    "paying_off" is False when the payment does not cover the interest (or takes 50+ years)."""
    monthly_rate = Decimal(rate_pct) / Decimal(100) / Decimal(12)
    remaining = Decimal(balance) - Decimal(lump_sum)
    payment = Decimal(monthly_payment or 0) + Decimal(extra_monthly)
    result = {"monthly_payment": money(payment), "lump_sum": money(lump_sum)}

    if remaining <= 0:
        return {**result, "paying_off": True, "months": 0, "payoff_month": None,
                "interest_remaining": 0.0, "total_remaining": money(Decimal(balance) if lump_sum else 0)}
    if payment <= 0 or payment <= cents(remaining * monthly_rate):
        return {**result, "paying_off": False, "months": None, "payoff_month": None,
                "interest_remaining": None, "total_remaining": None,
                "reason": "The monthly payment does not cover the interest."}

    months, interest_total, paid_total = 0, ZERO, ZERO
    while remaining > 0 and months < MAX_PROJECTION_MONTHS:
        interest = cents(remaining * monthly_rate)
        due = remaining + interest
        this_payment = min(payment, due)
        remaining = due - this_payment
        interest_total += interest
        paid_total += this_payment
        months += 1

    if remaining > 0:
        return {**result, "paying_off": False, "months": None, "payoff_month": None,
                "interest_remaining": None, "total_remaining": None,
                "reason": f"Not paid off within {MAX_PROJECTION_MONTHS // 12} years at this payment."}

    payoff = shift_months(first_month, months - 1)
    return {**result, "paying_off": True, "months": months, "payoff_month": month_key(payoff),
            "payoff_label": month_label(payoff), "interest_remaining": money(interest_total),
            "total_remaining": money(paid_total + Decimal(lump_sum))}


# ----------------------------------------------------------------------
# The service
# ----------------------------------------------------------------------

class DebtService:
    def __init__(self, cur, conn=None, today=None):
        self.cur = cur
        self.conn = conn
        self.today = today or date.today()

    # ---------------- reading ----------------

    def _debt_categories(self):
        self.cur.execute("SELECT id, name FROM budgets.categories WHERE type = 'debt' ORDER BY name")
        return self.cur.fetchall()

    def _accounts(self):
        self.cur.execute(
            f"SELECT {ACCOUNT_COLUMNS} FROM budgets.debt_accounts a "
            "JOIN budgets.categories c ON c.id = a.category_id"
        )
        keys = ("id", "category_id", "category", "lender", "original_amount", "start_date", "interest_rate",
                "term_months", "monthly_payment", "opening_balance", "opening_balance_date", "closed_date", "notes")
        return {row[1]: dict(zip(keys, row)) for row in self.cur.fetchall()}

    def _snapshots(self):
        self.cur.execute(
            "SELECT account_id, balance_date, balance, note FROM budgets.debt_balance_snapshots "
            "ORDER BY account_id, balance_date"
        )
        result = {}
        for account_id, day, balance, note in self.cur.fetchall():
            result.setdefault(account_id, []).append((day, balance, note))
        return result

    def _payments(self, category_id=None):
        """{category_id: [(date, amount, id, merchant)]}, oldest first. Includes future-dated ones.

        Two sources, never counted twice:
          * logged debt transactions (exact date and merchant), and
          * the debt planner table (budgets.debt) for finished months that have NO logged
            transaction for that loan, e.g. months typed straight into the planner before
            transactions were recorded. Those count as one payment on the last day of the
            month, with merchant PLANNER_MERCHANT and id None.
        A month that has transactions always uses the transactions, because each saved
        transaction is already added into that month's planner amount.
        The current month and later months come only from transactions: a planner amount
        there may be a plan, not a payment.
        """
        where, params = "", ()
        if category_id is not None:
            where, params = " AND category = %s", (category_id,)
        self.cur.execute(
            "SELECT category, date, amount, id, merchant FROM budgets.transactions "
            f"WHERE type = 'debt'{where} ORDER BY category, date, id", params)
        result, logged_months = {}, set()
        for category, day, amount, tx_id, merchant in self.cur.fetchall():
            result.setdefault(category, []).append((day, amount, tx_id, merchant))
            logged_months.add((category, first_of_month(day)))

        planner_where = " AND category_id = %s" if category_id is not None else ""
        self.cur.execute(
            "SELECT category_id, date_trunc('month', date::timestamp)::date, SUM(amount) "
            "FROM budgets.debt WHERE date < %s" + planner_where +
            " GROUP BY 1, 2 HAVING SUM(amount) > 0",
            (first_of_month(self.today), *params))
        for category, month, amount in self.cur.fetchall():
            if (category, month) in logged_months:
                continue
            month_end = shift_months(month, 1) - timedelta(days=1)
            result.setdefault(category, []).append((month_end, amount, None, PLANNER_MERCHANT))

        for rows in result.values():
            rows.sort(key=lambda r: (r[0], r[2] is None, r[2] or 0))
        return result

    def _debt_category(self, category_id):
        category_id = parse_int(category_id, "category_id", minimum=1)
        self.cur.execute("SELECT id, name, type FROM budgets.categories WHERE id = %s", (category_id,))
        row = self.cur.fetchone()
        if row is None:
            raise ApiError("That category does not exist.", 404)
        if row[2] != 'debt':
            raise ApiError(f"That category is for {row[2]}, not debt.")
        return row[0], row[1]

    # ---------------- per-loan numbers ----------------

    def _monthly_payment(self, account, past_payments):
        """The saved monthly payment, else the median of the last few months that had payments."""
        if account and account["monthly_payment"]:
            return Decimal(account["monthly_payment"]), "account"
        this_month = first_of_month(self.today)
        by_month = {}
        for day, amount, _id, _m in past_payments:
            month = first_of_month(day)
            if shift_months(this_month, -12) <= month:
                by_month[month] = by_month.get(month, ZERO) + Decimal(amount)
        recent = [by_month[m] for m in sorted(by_month)[-RECENT_PAYMENT_MONTHS:]]
        if not recent:
            return None, None
        return cents(median(recent)), "recent_payments"

    def _first_projected_month(self, past_payments):
        """This month if nothing has been paid in it yet, otherwise next month."""
        this_month = first_of_month(self.today)
        paid_this_month = any(first_of_month(p[0]) == this_month for p in past_payments)
        return shift_months(this_month, 1) if paid_this_month else this_month

    def _loan(self, category_id, name, account, snapshots, payments):
        today = self.today
        past = [p for p in payments if p[0] <= today]
        future = [p for p in payments if p[0] > today]
        year_start = date(today.year, 1, 1)
        last = past[-1] if past else None

        loan = {
            "category_id": category_id,
            "category": name,
            "setup_needed": account is None,
            "paid": {
                "all_time": money(sum((Decimal(p[1]) for p in past), ZERO)),
                "this_year": money(sum((Decimal(p[1]) for p in past if p[0] >= year_start), ZERO)),
                "payments": len(past),
                "months_from_planner": sum(1 for p in past if p[2] is None),
            },
            "last_payment": {"date": iso(last[0]), "amount": money(last[1]), "merchant": last[3]} if last else None,
            "scheduled": {
                "count": len(future),
                "total": money(sum((Decimal(p[1]) for p in future), ZERO)),
                "next_date": iso(future[0][0]) if future else None,
            },
        }
        if account is None:
            loan["status"] = "setup_needed"
            return loan

        sim = simulate(account["opening_balance_date"], account["opening_balance"], account["interest_rate"],
                       payments, [(s[0], s[1]) for s in snapshots], today)
        balance = sim["principal"] + sim["accrued"]
        tracked = [e for e in sim["events"] if e["kind"] == "payment"]
        statements = [e for e in sim["events"] if e["kind"] == "statement"]

        def split(events):
            return {
                "paid": money(sum((e["amount"] for e in events), ZERO)),
                "principal": money(sum((e["principal"] for e in events), ZERO)),
                "interest": money(sum((e["interest"] for e in events), ZERO)),
            }

        basis_amount = account["original_amount"] or account["opening_balance"]
        basis = "original_amount" if account["original_amount"] else "opening_balance"
        progress = None
        if basis_amount and Decimal(basis_amount) > 0:
            progress = round(float((Decimal(basis_amount) - balance) / Decimal(basis_amount) * 100), 1)

        closed = account["closed_date"] is not None and account["closed_date"] <= today
        payment, payment_source = self._monthly_payment(account, past)
        last_statement = statements[-1] if statements else None

        loan.update({
            "status": "paid_off" if closed or balance <= 0 else "active",
            "account_id": account["id"],
            "lender": account["lender"],
            "interest_rate": float(account["interest_rate"]),
            "as_of": iso(today),
            "balance": money(balance),
            "principal_balance": money(sim["principal"]),
            "accrued_interest": money(sim["accrued"]),
            # "statement" only when nothing has been subtracted since today's lender balance
            "balance_source": "statement" if (last_statement and last_statement["date"] == today
                                              and sim["events"][-1]["kind"] == "statement") else "estimated",
            "opening": {"date": iso(account["opening_balance_date"]), "balance": money(account["opening_balance"])},
            "original_amount": money(account["original_amount"]),
            "progress_pct": progress,
            "progress_basis": basis,
            "since_opening": split(tracked),
            "this_year_split": split([e for e in tracked if e["date"] >= year_start]),
            "last_statement": {
                "date": iso(last_statement["date"]), "balance": money(last_statement["balance"]),
                "correction": money(last_statement["correction"]),
            } if last_statement else None,
            "payment_used": {"amount": money(payment), "source": payment_source},
        })
        if loan["status"] == "active":
            loan["projection"] = project(balance, account["interest_rate"], payment,
                                         self._first_projected_month(past))
        return loan

    # ---------------- endpoints ----------------

    def summary(self):
        """GET /debtSummary: every debt category, with its balance and payoff when it is set up."""
        accounts, snapshots, payments = self._accounts(), self._snapshots(), self._payments()
        loans = []
        for category_id, name in self._debt_categories():
            account = accounts.get(category_id)
            snaps = snapshots.get(account["id"], []) if account else []
            loans.append(self._loan(category_id, name, account, snaps, payments.get(category_id, [])))

        active = [l for l in loans if l.get("status") == "active"]
        payoff_months = [l["projection"]["payoff_month"] for l in active
                         if l.get("projection", {}).get("paying_off") and l["projection"]["payoff_month"]]
        all_projected = len(payoff_months) == len(active)
        tracked = [l for l in loans if not l["setup_needed"]]
        return {
            "as_of": iso(self.today),
            "totals": {
                "balance": money(sum((Decimal(str(l["balance"])) for l in tracked), ZERO)),
                "paid_this_year": money(sum((Decimal(str(l["paid"]["this_year"])) for l in loans), ZERO)),
                "principal_this_year": money(sum((Decimal(str(l["this_year_split"]["principal"])) for l in tracked), ZERO)),
                "interest_this_year": money(sum((Decimal(str(l["this_year_split"]["interest"])) for l in tracked), ZERO)),
                "debt_free_month": max(payoff_months) if payoff_months and all_projected else None,
                "loans_active": len(active),
                "loans_setup_needed": sum(1 for l in loans if l["setup_needed"]),
            },
            "loans": loans,
        }

    def history(self, category_id):
        """POST /debtHistory: month by month paid / principal / interest / balance for one loan."""
        category_id, name = self._debt_category(category_id)
        account = self._accounts().get(category_id)
        payments = self._payments(category_id).get(category_id, [])
        past = [p for p in payments if p[0] <= self.today]

        months = {}
        def row(day):
            key = first_of_month(day)
            return months.setdefault(key, {"paid": ZERO, "principal": ZERO, "interest": ZERO,
                                           "payments": 0, "balance_end": None, "statement": None})

        if account is None:
            for day, amount, _id, _m in past:
                r = row(day)
                r["paid"] += Decimal(amount)
                r["payments"] += 1
        else:
            snaps = self._snapshots().get(account["id"], [])
            sim = simulate(account["opening_balance_date"], account["opening_balance"], account["interest_rate"],
                           payments, [(s[0], s[1]) for s in snaps], self.today)
            row(account["opening_balance_date"])["balance_end"] = Decimal(account["opening_balance"])
            for e in sim["events"]:
                r = row(e["date"])
                if e["kind"] == "payment":
                    r["paid"] += e["amount"]
                    r["principal"] += e["principal"]
                    r["interest"] += e["interest"]
                    r["payments"] += 1
                    r["balance_end"] = e["balance_after"]
                else:
                    r["statement"] = {"date": iso(e["date"]), "balance": money(e["balance"]),
                                      "correction": money(e["correction"])}
                    r["balance_end"] = e["balance"]
            # Payments from before tracking started still show up as paid
            for day, amount, _id, _m in past:
                if day <= account["opening_balance_date"]:
                    r = row(day)
                    r["paid"] += Decimal(amount)
                    r["payments"] += 1

        rows, carried = [], None
        if months:
            current, end = min(months), first_of_month(self.today)
            while current <= end:
                r = months.get(current, {"paid": ZERO, "principal": ZERO, "interest": ZERO,
                                         "payments": 0, "balance_end": None, "statement": None})
                if r["balance_end"] is not None:
                    carried = r["balance_end"]
                tracked_month = account is not None and current >= first_of_month(account["opening_balance_date"])
                rows.append({
                    "month": month_key(current), "label": month_label(current),
                    "paid": money(r["paid"]), "payments": r["payments"],
                    "principal": money(r["principal"]) if tracked_month else None,
                    "interest": money(r["interest"]) if tracked_month else None,
                    "balance_end": money(carried) if tracked_month else None,
                    "statement": r["statement"],
                })
                current = shift_months(current, 1)

        return {"category_id": category_id, "category": name, "setup_needed": account is None, "months": rows}

    def payoff_scenario(self, category_id, extra_monthly=None, lump_sum=None):
        """POST /debtPayoffScenario: today's plan against paying extra each month and/or a lump sum now."""
        category_id, name = self._debt_category(category_id)
        extra = parse_amount(extra_monthly, "extra_monthly") if extra_monthly is not None else ZERO
        lump = parse_amount(lump_sum, "lump_sum") if lump_sum is not None else ZERO
        if extra < 0 or lump < 0:
            raise ApiError("extra_monthly and lump_sum cannot be negative.")

        accounts = self._accounts()
        account = accounts.get(category_id)
        if account is None:
            raise ApiError(f"Set up {name} first (POST /saveDebtAccount).", 404)
        loan = self._loan(category_id, name, account, self._snapshots().get(account["id"], []),
                          self._payments(category_id).get(category_id, []))
        if loan["status"] != "active":
            raise ApiError(f"{name} is already paid off.")

        balance = Decimal(str(loan["balance"]))
        payment = Decimal(str(loan["payment_used"]["amount"] or 0))
        first = self._first_projected_month([p for p in self._payments(category_id).get(category_id, [])
                                             if p[0] <= self.today])
        current = project(balance, account["interest_rate"], payment, first)
        faster = project(balance, account["interest_rate"], payment, first, extra, lump)

        both = current["paying_off"] and faster["paying_off"]
        return {
            "category_id": category_id, "category": name, "balance": loan["balance"],
            "interest_rate": loan["interest_rate"], "payment_used": loan["payment_used"],
            "extra_monthly": money(extra), "lump_sum": money(lump),
            "current_plan": current, "with_extra": faster,
            "months_saved": (current["months"] - faster["months"]) if both else None,
            "interest_saved": money(Decimal(str(current["interest_remaining"])) - Decimal(str(faster["interest_remaining"])))
            if both else None,
        }

    def accounts(self):
        """GET /debtAccounts: the loan settings (for a setup form), one entry per debt category."""
        accounts, snapshots = self._accounts(), self._snapshots()
        result = []
        for category_id, name in self._debt_categories():
            a = accounts.get(category_id)
            entry = {"category_id": category_id, "category": name, "account": None}
            if a:
                entry["account"] = {
                    "id": a["id"], "lender": a["lender"], "original_amount": money(a["original_amount"]),
                    "start_date": iso(a["start_date"]), "interest_rate": float(a["interest_rate"]),
                    "term_months": a["term_months"], "monthly_payment": money(a["monthly_payment"]),
                    "opening_balance": money(a["opening_balance"]),
                    "opening_balance_date": iso(a["opening_balance_date"]),
                    "closed_date": iso(a["closed_date"]), "notes": a["notes"],
                    "statements": [{"date": iso(d), "balance": money(b), "note": n}
                                   for d, b, n in snapshots.get(a["id"], [])],
                }
            result.append(entry)
        return result

    # ---------------- writing (new tables only) ----------------

    def save_account(self, body):
        """POST /saveDebtAccount: creates or updates the loan for one debt category."""
        if not isinstance(body, dict):
            raise ApiError("account must be an object.")
        category_id, _name = self._debt_category(body.get("category_id"))
        opening_balance = parse_amount(body.get("opening_balance"), "opening_balance")
        if opening_balance < 0:
            raise ApiError("opening_balance cannot be negative.")
        if body.get("opening_balance_date") is None:
            raise ApiError("Missing field: opening_balance_date.")
        values = {
            "lender": parse_text(body.get("lender"), "lender", 200, required=False) or None,
            "original_amount": optional(body, "original_amount", parse_amount),
            "start_date": optional(body, "start_date", parse_client_date),
            "interest_rate": parse_rate(body.get("interest_rate", 0)),
            "term_months": optional(body, "term_months", parse_int, minimum=1, maximum=600),
            "monthly_payment": optional(body, "monthly_payment", parse_amount),
            "opening_balance": opening_balance,
            "opening_balance_date": parse_client_date(body.get("opening_balance_date"), "opening_balance_date"),
            "closed_date": optional(body, "closed_date", parse_client_date),
            "notes": parse_text(body.get("notes"), "notes", 255, required=False) or None,
        }
        for key in ("original_amount", "monthly_payment"):
            if values[key] is not None and values[key] <= 0:
                raise ApiError(f"{key} must be greater than zero.")

        columns = list(values)
        self.cur.execute(
            f"INSERT INTO budgets.debt_accounts (category_id, {', '.join(columns)}) "
            f"VALUES (%s, {', '.join(['%s'] * len(columns))}) "
            f"ON CONFLICT (category_id) DO UPDATE SET "
            f"{', '.join(f'{c} = EXCLUDED.{c}' for c in columns)}, updated_at = CURRENT_TIMESTAMP "
            "RETURNING id",
            (category_id, *values.values()),
        )
        account_id = self.cur.fetchone()[0]
        self.conn.commit()
        return {"id": account_id, "category_id": category_id}

    def save_statement(self, body):
        """POST /saveDebtBalance: records a balance from a lender statement (replaces one on the same date)."""
        if not isinstance(body, dict):
            raise ApiError("Send a JSON object.")
        category_id, name = self._debt_category(body.get("category_id"))
        account = self._accounts().get(category_id)
        if account is None:
            raise ApiError(f"Set up {name} first (POST /saveDebtAccount).", 404)
        if body.get("date") is None:
            raise ApiError("Missing field: date.")
        day = parse_client_date(body.get("date"))
        balance = parse_amount(body.get("balance"), "balance")
        if balance < 0:
            raise ApiError("balance cannot be negative.")
        if day <= account["opening_balance_date"]:
            raise ApiError("A statement must be dated after the opening balance date. "
                           "To change the starting point, update the account instead.")
        if day > self.today:
            raise ApiError("A statement cannot be dated in the future.")
        note = parse_text(body.get("note"), "note", 255, required=False) or None

        self.cur.execute(
            "INSERT INTO budgets.debt_balance_snapshots (account_id, balance_date, balance, note) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (account_id, balance_date) "
            "DO UPDATE SET balance = EXCLUDED.balance, note = EXCLUDED.note RETURNING id",
            (account["id"], day, balance, note),
        )
        snapshot_id = self.cur.fetchone()[0]
        self.conn.commit()
        return {"id": snapshot_id, "category_id": category_id, "date": iso(day), "balance": money(balance)}