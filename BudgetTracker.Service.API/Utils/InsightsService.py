# FILE: BudgetTracker.Service.API/Utils/InsightsService.py  (NEW file)
"""Read-only money insights for the Dashboard. Nothing here writes to the database.

Numbers come from the planner tables (the same source as the Dashboard charts), plus
logged transactions for the "large purchase" check.
"""
from datetime import date
from decimal import Decimal
from statistics import median

from Utils.RequestUtil import ApiError

# Table names come only from this fixed list, never from the request.
PLANNER_TABLES = {
    'income': 'budgets.income',
    'expense': 'budgets.expenses',
    'savings': 'budgets.savings',
    'debt': 'budgets.debt',
}

MAX_MONTHS = 60
# An expense category is "unusual" this month when it is at least 1.5x its usual amount
# AND at least $50 more. "Usual" is the median of its previous 6 months, and needs 3+ of them.
UNUSUAL_RATIO = 1.5
UNUSUAL_MIN_EXTRA = 50.0
HISTORY_MONTHS = 6
MIN_HISTORY = 3
# A single purchase is "large" when it is at least $100 and 3x the usual purchase for its
# category (median of the previous 12 months, needs 5+ purchases).
LARGE_MIN_AMOUNT = 100
LARGE_TIMES_TYPICAL = 3
LARGE_HISTORY_MONTHS = 12
MIN_LARGE_HISTORY = 5
MAX_ITEMS = 5
# Month-over-month: category changes smaller than this are noise and are not listed as movers.
MOVER_MIN_CHANGE = 10
TREND_MONTHS = 12

MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def shift_months(first_of_month, count):
    """The first of the month `count` months later (negative = earlier)."""
    index = first_of_month.year * 12 + (first_of_month.month - 1) + count
    return date(index // 12, index % 12 + 1, 1)


def month_label(first_of_month):
    return f"{MONTH_NAMES[first_of_month.month - 1]}-{first_of_month.year}"


def month_list(first, last):
    months, current = [], first
    while current <= last:
        months.append(current)
        current = shift_months(current, 1)
    return months


def money(value):
    return round(float(value or 0), 2)


def ratio_or_none(top, bottom):
    return round(float(top or 0) / float(bottom), 4) if bottom else None


def percent_change(current, previous):
    if not previous:
        return None
    return round((float(current) - float(previous)) / float(previous) * 100, 1)


class InsightsService:
    def __init__(self, cur):
        self.cur = cur

    # ------------------------------------------------------------------
    # Reading
    # ------------------------------------------------------------------

    def _monthly_totals(self, table, first, following):
        """{first of month: total} for one planner table between two dates."""
        self.cur.execute(
            f"SELECT date_trunc('month', date::timestamp)::date, SUM(amount) FROM {table} "
            "WHERE date >= %s AND date < %s GROUP BY 1",
            (first, following),
        )
        return {row[0]: row[1] for row in self.cur.fetchall()}

    def _category_months(self, first, following):
        """{category name: {first of month: total}} for expenses between two dates."""
        self.cur.execute(
            "SELECT c.name, date_trunc('month', e.date::timestamp)::date, SUM(e.amount) "
            "FROM budgets.expenses e JOIN budgets.categories c ON c.id = e.category_id "
            "WHERE e.date >= %s AND e.date < %s GROUP BY 1, 2",
            (first, following),
        )
        result = {}
        for name, month, total in self.cur.fetchall():
            result.setdefault(name, {})[month] = total
        return result

    # ------------------------------------------------------------------
    # The insights
    # ------------------------------------------------------------------

    def build(self, start_date, end_date):
        if end_date < start_date:
            raise ApiError("end must not be before start.")
        first = date(start_date.year, start_date.month, 1)
        last = date(end_date.year, end_date.month, 1)
        months = month_list(first, last)
        count = len(months)
        if count > MAX_MONTHS:
            raise ApiError(f"Pick a range of {MAX_MONTHS // 12} years or less.")

        # One read per table covers this range, the range before it, and the same months a year ago.
        earliest = shift_months(first, -max(count, 12))
        following = shift_months(last, 1)
        totals = {kind: self._monthly_totals(table, earliest, following) for kind, table in PLANNER_TABLES.items()}

        def total(kind, month_dates):
            return sum((totals[kind].get(m, Decimal(0)) for m in month_dates), Decimal(0))

        previous_months = [shift_months(m, -count) for m in months]
        year_ago_months = [shift_months(m, -12) for m in months]

        return {
            "range": {
                "start": first.isoformat(),
                "end": last.isoformat(),
                "months": count,
                "last_month": month_label(last),
            },
            "savings_rate": {
                "current": ratio_or_none(total('savings', months), total('income', months)),
                "previous": ratio_or_none(total('savings', previous_months), total('income', previous_months)),
                "income": money(total('income', months)),
                "savings": money(total('savings', months)),
                "monthly": [
                    {"month": month_label(m),
                     "rate": ratio_or_none(totals['savings'].get(m), totals['income'].get(m))}
                    for m in months
                ],
            },
            "year_over_year": {
                "previous_start": year_ago_months[0].isoformat(),
                "previous_end": year_ago_months[-1].isoformat(),
                **{
                    kind: {
                        "current": money(total(kind, months)),
                        "previous": money(total(kind, year_ago_months)),
                        "change_pct": percent_change(total(kind, months), total(kind, year_ago_months)),
                    }
                    for kind in PLANNER_TABLES
                },
            },
            "unusual_spending": {
                "month": month_label(last),
                "alerts": self._unusual_categories(last),
            },
            "large_transactions": self._large_transactions(last),
        }

    def _unusual_categories(self, last):
        history_start = shift_months(last, -HISTORY_MONTHS)
        by_category = self._category_months(history_start, shift_months(last, 1))
        alerts = []

        for name, by_month in by_category.items():
            current = float(by_month.get(last, 0))
            history = [float(by_month[m]) for m in month_list(history_start, shift_months(last, -1))
                       if float(by_month.get(m, 0)) > 0]
            if current <= 0 or len(history) < MIN_HISTORY:
                continue
            usual = median(history)
            if usual > 0 and current >= usual * UNUSUAL_RATIO and current - usual >= UNUSUAL_MIN_EXTRA:
                alerts.append({
                    "category": name,
                    "amount": round(current, 2),
                    "usual": round(usual, 2),
                    "extra": round(current - usual, 2),
                    "times_usual": round(current / usual, 1),
                    "months_compared": len(history),
                })

        alerts.sort(key=lambda a: a["extra"], reverse=True)
        return alerts[:MAX_ITEMS]

    def _large_transactions(self, last):
        month_end = shift_months(last, 1)
        history_start = shift_months(last, -LARGE_HISTORY_MONTHS)
        self.cur.execute(
            "WITH typical AS ("
            "  SELECT category, percentile_cont(0.5) WITHIN GROUP (ORDER BY amount) AS med, COUNT(*) AS n"
            "  FROM budgets.transactions WHERE type = 'expense' AND date >= %s AND date < %s GROUP BY category"
            ") "
            "SELECT t.id, t.date, t.merchant, c.name, t.amount, ty.med "
            "FROM budgets.transactions t "
            "JOIN budgets.categories c ON c.id = t.category "
            "JOIN typical ty ON ty.category = t.category "
            "WHERE t.type = 'expense' AND t.date >= %s AND t.date < %s AND ty.n >= %s "
            "  AND t.amount >= GREATEST(%s, %s * ty.med) "
            "ORDER BY t.amount DESC LIMIT %s",
            (history_start, last, last, month_end, MIN_LARGE_HISTORY, LARGE_MIN_AMOUNT, LARGE_TIMES_TYPICAL, MAX_ITEMS),
        )
        return [
            {"id": r[0], "date": r[1].isoformat(), "merchant": r[2], "category": r[3],
             "amount": money(r[4]), "typical": money(r[5])}
            for r in self.cur.fetchall()
        ]

    # ------------------------------------------------------------------
    # Month over month
    # ------------------------------------------------------------------

    def month_over_month(self, end_date, complete_only=False, today=None):
        """One month against the month before it, the biggest expense movers, and a 12-month trend.

        The month is the one containing end_date. With complete_only, a month that is still in
        progress is replaced by the month before it, so a half-finished month is never compared
        with a finished one."""
        today = today or date.today()
        month = date(end_date.year, end_date.month, 1)
        this_month = date(today.year, today.month, 1)
        in_progress = month >= this_month
        shifted = False
        if complete_only and in_progress:
            month = shift_months(this_month, -1)
            in_progress, shifted = False, True
        previous = shift_months(month, -1)

        earliest = shift_months(month, -(TREND_MONTHS - 1))
        following = shift_months(month, 1)
        totals = {kind: self._monthly_totals(table, earliest, following) for kind, table in PLANNER_TABLES.items()}

        def pair(kind):
            current, before = totals[kind].get(month, Decimal(0)), totals[kind].get(previous, Decimal(0))
            return {
                "current": money(current),
                "previous": money(before),
                "change": money(current - before),
                "change_pct": percent_change(current, before),
            }

        return {
            "month": month_label(month),
            "previous_month": month_label(previous),
            "in_progress": in_progress,
            "shifted_to_last_complete": shifted,
            "totals": {kind: pair(kind) for kind in PLANNER_TABLES},
            "savings_rate": {
                "current": ratio_or_none(totals['savings'].get(month), totals['income'].get(month)),
                "previous": ratio_or_none(totals['savings'].get(previous), totals['income'].get(previous)),
            },
            "movers": self._movers(month, previous),
            "trend": [
                {"month": month_label(m), **{kind: money(totals[kind].get(m)) for kind in PLANNER_TABLES}}
                for m in month_list(earliest, month)
            ],
        }

    def _movers(self, month, previous):
        by_category = self._category_months(previous, shift_months(month, 1))
        rows = []
        for name, by_month in by_category.items():
            current, before = float(by_month.get(month, 0)), float(by_month.get(previous, 0))
            change = round(current - before, 2)
            if abs(change) < MOVER_MIN_CHANGE:
                continue
            rows.append({
                "category": name,
                "current": round(current, 2),
                "previous": round(before, 2),
                "change": change,
                "change_pct": percent_change(current, before),
            })
        increases = sorted((r for r in rows if r["change"] > 0), key=lambda r: r["change"], reverse=True)
        decreases = sorted((r for r in rows if r["change"] < 0), key=lambda r: r["change"])
        return {"increases": increases[:MAX_ITEMS], "decreases": decreases[:MAX_ITEMS]}