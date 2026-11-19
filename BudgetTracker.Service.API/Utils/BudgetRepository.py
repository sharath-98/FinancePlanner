# FILE: BudgetTracker.Service.API/Utils/BudgetRepository.py  (REPLACE existing file)
import calendar
from datetime import datetime
from decimal import Decimal

import pandas as pd

from Utils.HelperUtil import HelperUtil
from Utils.RequestUtil import (
    MONTHS,
    ApiError,
    month_bounds,
    parse_amount,
    parse_client_date,
    parse_int,
    parse_text,
    parse_year,
)

# Table and function names are only ever taken from these fixed lists, never from the request.
PLANNER_TABLE_BY_SCREEN = {
    'Income': ('budgets.income', 'income'),
    'Expenses': ('budgets.expenses', 'expense'),
    'Savings': ('budgets.savings', 'saving'),
    'Debts': ('budgets.debt', 'debt'),
}
PLANNER_TABLE_BY_TRANSACTION_TYPE = {
    'income': 'budgets.income',
    'expense': 'budgets.expenses',
    'saving': 'budgets.savings',
    'debt': 'budgets.debt',
}


class BudgetRepository:
    """All database access for the API.

    Reading methods only read. Writing methods run all their statements in one
    database transaction and call conn.commit() once at the end. If anything
    fails first, an exception is raised and nothing is saved.
    """

    def __init__(self, cur=None, conn=None):
        self.cur = cur
        self.conn = conn

    def income_expense_saving_extractor(self, rows, category):
        data = [
            {"category": row[0], "month": calendar.month_abbr[row[1]], "amount": float(row[2])}
            for row in rows
        ]

        # Convert to DataFrame
        df_raw = pd.DataFrame(data)

        # Pivot table: categories vs month columns, sum totals
        df_pivot = df_raw.pivot_table(
            index='category',
            columns='month',
            values='amount',
            aggfunc='sum',
            fill_value=0
        )

        # Build ordered list of month abbreviations
        month_order = list(calendar.month_abbr)[1:]  # ['Jan', 'Feb', ..., 'Dec']
        df_pivot = df_pivot.reindex(columns=month_order, fill_value=0)

        # Reset index to restore 'category' as a column
        df_pivot = df_pivot.reset_index().rename(columns={'category': category})

        df_final = pd.concat([df_pivot], ignore_index=True)

        # Row-wise total
        df_final['Total'] = df_final.loc[:, 'Jan':].sum(axis=1).round(2)

        # Calculate column-wise total (sum for each month plus total)
        total_row = df_final.loc[:, 'Jan':].sum(axis=0).round(2)
        total_row[category] = 'Total'  # Label for total row

        # Append the total row to the DataFrame
        df_final = pd.concat([df_final, total_row.to_frame().T], ignore_index=True)

        return df_final

    # ------------------------------------------------------------------
    # Planner grids (one row per category, one column per month)
    # ------------------------------------------------------------------

    def _planner_grid(self, function_name, label, year):
        self.cur.execute(f"SELECT * FROM {function_name}(%s)", (parse_year(year),))
        rows = self.cur.fetchall()
        if len(rows) == 0:
            return None
        return self.income_expense_saving_extractor(rows, label)

    def get_income(self, year):
        return self._planner_grid("budgets.get_monthly_income", "Income", year)

    def get_debts(self, year):
        return self._planner_grid("budgets.get_monthly_debts", "Debts", year)

    def get_expenses(self, year):
        return self._planner_grid("budgets.get_monthly_expense", "Expenses", year)

    def get_savings(self, year):
        return self._planner_grid("budgets.get_monthly_savings", "Savings", year)

    # ------------------------------------------------------------------
    # Lookups
    # ------------------------------------------------------------------

    def get_categories(self):
        self.cur.execute("SELECT id, type, name FROM budgets.categories ORDER BY id")
        rows = self.cur.fetchall()

        data = [{"id": row[0], "type": row[1], "name": row[2]} for row in rows]

        df_final = pd.DataFrame(data)
        df_final = df_final.fillna(0)

        self.cur.execute("SELECT DISTINCT type FROM budgets.categories")
        types = [t[0] for t in self.cur.fetchall()]

        return df_final, types

    def get_users(self):
        self.cur.execute("SELECT id, username FROM budgets.users ORDER BY id")
        rows = self.cur.fetchall()

        if len(rows) == 0:
            return None
        return pd.DataFrame([{"id": row[0], "name": row[1]} for row in rows])

    def get_user_for_login(self, username):
        """(id, username, password_hash) for a username, ignoring capitals, or None."""
        self.cur.execute(
            "SELECT id, username, password_hash FROM budgets.users WHERE lower(username) = lower(%s)",
            (username,),
        )
        return self.cur.fetchone()

    def get_subcategory(self, category_id):
        category_id = parse_int(category_id, "category_id", minimum=1)
        self.cur.execute(
            "SELECT merchant FROM budgets.subcategory WHERE category_id = %s ORDER BY id",
            (category_id,),
        )
        data = [row[0] for row in self.cur.fetchall()]
        return data if len(data) > 0 else None

    def save_subcategory(self, category_id, merchant):
        category_id = parse_int(category_id, "category_id", minimum=1)
        merchant = parse_text(merchant, "merchant", 255)

        self.cur.execute("SELECT 1 FROM budgets.categories WHERE id = %s", (category_id,))
        if self.cur.fetchone() is None:
            raise ApiError("That category does not exist.", 404)

        # Saving the same merchant twice for a category would only create a duplicate entry.
        self.cur.execute(
            "SELECT 1 FROM budgets.subcategory WHERE category_id = %s AND lower(merchant) = lower(%s)",
            (category_id, merchant),
        )
        if self.cur.fetchone() is None:
            self.cur.execute(
                "INSERT INTO budgets.subcategory (category_id, merchant) VALUES (%s, %s)",
                (category_id, merchant),
            )

        self.cur.execute(
            "SELECT id, category_id, merchant FROM budgets.subcategory WHERE category_id = %s ORDER BY id",
            (category_id,),
        )
        rows = self.cur.fetchall()
        self.conn.commit()

        df_final = pd.DataFrame(
            [{"id": row[0], "category_id": row[1], "merchant": row[2]} for row in rows]
        )
        df_final = df_final.fillna(0)
        return df_final if len(df_final) > 0 else None

    # ------------------------------------------------------------------
    # Transactions
    # ------------------------------------------------------------------

    def get_yearly_transaction(self, year):
        self.cur.execute("SELECT * FROM budgets.get_yearly_transaction(%s)", (parse_year(year),))
        rows = self.cur.fetchall()

        # A year with no transactions is a normal answer (an empty list), not an error.
        if len(rows) == 0:
            return None

        data = [
            {"id": row[0], "date": row[1], "type": row[2], "category": row[3],
             "amount": row[4], "details": row[5], "merchant": row[6]}
            for row in rows
        ]

        df_final = pd.DataFrame(data)
        df_final['date'] = pd.to_datetime(df_final['date'])
        df_final['date'] = df_final['date'].dt.strftime('%m-%d-%Y')

        df_final = df_final.fillna(0)
        return df_final

    def save_transaction(self, transaction):
        """Saves the transaction and adds its amount to the planner, as one all-or-nothing step."""
        if not isinstance(transaction, dict):
            raise ApiError("transaction must be an object.")

        tx_type = transaction.get('type')
        if tx_type not in PLANNER_TABLE_BY_TRANSACTION_TYPE:
            raise ApiError("type must be income, expense, saving or debt.")

        category = transaction.get('category')
        category_id = parse_int(
            category.get('id') if isinstance(category, dict) else category, "category", minimum=1
        )
        paid_by = parse_int(transaction.get('paidby'), "paidby", minimum=1)
        amount = parse_amount(transaction.get('amount'))
        if amount <= 0:
            raise ApiError("amount must be greater than zero.")
        tx_date = parse_client_date(transaction.get('date'))
        merchant = parse_text(transaction.get('merchant'), "merchant", 200)
        details = parse_text(transaction.get('details'), "details", 255, required=False)

        self.cur.execute("SELECT type FROM budgets.categories WHERE id = %s", (category_id,))
        row = self.cur.fetchone()
        if row is None:
            raise ApiError("That category does not exist.", 404)
        if row[0] != tx_type:
            raise ApiError(f"That category is for {row[0]} transactions, not {tx_type}.")

        self.cur.execute("SELECT 1 FROM budgets.users WHERE id = %s", (paid_by,))
        if self.cur.fetchone() is None:
            raise ApiError("That payer does not exist.", 404)

        self.cur.execute(
            "INSERT INTO budgets.transactions "
            "(user_id, date, type, category, amount, details, created_at, merchant) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (paid_by, tx_date, tx_type, category_id, amount, details, datetime.now(), merchant),
        )
        self._set_planner_amount(
            PLANNER_TABLE_BY_TRANSACTION_TYPE[tx_type], category_id, tx_date.year, tx_date.month,
            amount, add=True,
        )
        self.conn.commit()
        return 1

    # ------------------------------------------------------------------
    # Planner edits
    # ------------------------------------------------------------------

    def _resolve_planner_cell(self, data):
        """Checks the screen, month, year and category of a planner cell.

        Returns (table, category_type, category_id, year, month)."""
        if not isinstance(data, dict):
            raise ApiError("data must be an object.")

        screen = PLANNER_TABLE_BY_SCREEN.get(data.get('type'))
        if screen is None:
            raise ApiError("type must be Income, Expenses, Savings or Debts.")
        table, category_type = screen

        if data.get('month') not in MONTHS:
            raise ApiError("month must be a three-letter month such as Jan.")
        month = MONTHS.index(data['month']) + 1
        year = parse_year(data.get('year'))
        category_name = parse_text(data.get('category'), "category", 100)

        self.cur.execute("SELECT id, type FROM budgets.categories WHERE name = %s", (category_name,))
        row = self.cur.fetchone()
        if row is None:
            raise ApiError(f"Category '{category_name}' does not exist.", 404)
        if row[1] != category_type:
            raise ApiError(f"'{category_name}' is not an {data['type']} category.")
        return table, category_type, row[0], year, month

    def get_month_activity(self, data):
        """Read-only: what one planner cell holds and what the logged transactions add up to.

        Used by the planner to warn before a typed number replaces logged transactions."""
        table, category_type, category_id, year, month = self._resolve_planner_cell(data)
        start, following = month_bounds(year, month)
        count, total = self._transaction_stats(category_type, category_id, start, following)
        self.cur.execute(
            f"SELECT COALESCE(SUM(amount), 0) FROM {table} "
            "WHERE category_id = %s AND date >= %s AND date < %s",
            (category_id, start, following),
        )
        planner_amount = self.cur.fetchone()[0]
        self.cur.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM budgets.planner_adjustments "
            "WHERE kind = %s AND category_id = %s AND month = %s",
            (category_type, category_id, start),
        )
        adjustments_total = self.cur.fetchone()[0]
        return {
            'transaction_count': count,
            'transaction_total': total,
            'planner_amount': planner_amount,
            'adjustments_total': adjustments_total,
        }

    def update_src_data(self, data):
        """Sets one planner cell (a category in one month) to the amount typed in the grid."""
        table, category_type, category_id, year, month = self._resolve_planner_cell(data)
        amount = parse_amount(data.get('amount'))

        previous = self._set_planner_amount(table, category_id, year, month, amount, add=False)

        # If this month already has logged transactions for the category, the typed number
        # may differ from what they add up to. Keep the difference as an adjustment so the
        # planner stays "transactions + adjustments" and nothing is lost silently.
        difference = amount - previous
        if difference != 0:
            start, following = month_bounds(year, month)
            count, _total = self._transaction_stats(category_type, category_id, start, following)
            if count > 0:
                self.cur.execute(
                    "INSERT INTO budgets.planner_adjustments (kind, category_id, month, amount, note) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (category_type, category_id, start, difference, "Planner edit"),
                )
        self.conn.commit()

    def _transaction_stats(self, tx_type, category_id, start, following):
        """Number and total of logged transactions for a category in [start, following)."""
        self.cur.execute(
            "SELECT count(*), COALESCE(SUM(amount), 0) FROM budgets.transactions "
            "WHERE type = %s AND category = %s AND date >= %s AND date < %s",
            (tx_type, category_id, start, following),
        )
        count, total = self.cur.fetchone()
        return count, total

    def _set_planner_amount(self, table, category_id, year, month, amount, add):
        """Adds to (add=True) or replaces (add=False) a category's amount for one month.
        Returns the amount the month held before the change (0 if it had no row).

        The planner holds one row per category and month. A lock for that
        category and month is taken first, so two requests at the same moment
        cannot both decide the row is missing and insert it twice.
        """
        start, following = month_bounds(year, month)

        self.cur.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))", (f"{table}:{category_id}:{year}-{month}",)
        )
        self.cur.execute(
            f"SELECT id, amount FROM {table} WHERE category_id = %s AND date >= %s AND date < %s ORDER BY id",
            (category_id, start, following),
        )
        found = self.cur.fetchall()
        ids = [r[0] for r in found]
        previous = sum((r[1] for r in found), Decimal('0'))

        if not ids:
            self.cur.execute(
                f"INSERT INTO {table} (category_id, amount, date) VALUES (%s, %s, %s)",
                (category_id, amount, start),
            )
        elif add:
            self.cur.execute(f"UPDATE {table} SET amount = amount + %s WHERE id = %s", (amount, ids[0]))
        else:
            self.cur.execute(f"UPDATE {table} SET amount = %s WHERE id = %s", (amount, ids[0]))
            # If older duplicate rows exist for this month, they must not add to the total typed in.
            for extra_id in ids[1:]:
                self.cur.execute(f"UPDATE {table} SET amount = 0 WHERE id = %s", (extra_id,))
        return previous

    # ------------------------------------------------------------------
    # Dashboard charts
    # ------------------------------------------------------------------

    def _month_range(self, start_date, end_date):
        help_util = HelperUtil()
        start = datetime(start_date.year, start_date.month, 1)
        end = help_util.get_last_day_of_month(end_date.year, end_date.month)
        return start, end, help_util.month_iter(start, end)

    def summary_chart_query_generator(self, table_name):
        return (
            f"SELECT EXTRACT(YEAR FROM date) as year, EXTRACT(MONTH FROM date) as month, "
            f"SUM(amount) as total FROM {table_name} WHERE date BETWEEN %s AND %s GROUP BY year, month"
        )

    def subchart_query_generator(self, table_name):
        return (
            f"SELECT c.name as category, SUM(amount) as amount FROM {table_name} i "
            f"JOIN budgets.categories c ON i.category_id = c.id "
            f"WHERE date BETWEEN %s AND %s GROUP BY i.category_id, c.name"
        )

    def fetch_data_as_dict(self, table_name, start, end):
        self.cur.execute(self.summary_chart_query_generator(table_name), (start, end))
        return {(int(row[0]), int(row[1])): row[2] for row in self.cur.fetchall()}

    def fetch_sub_chart_data(self, table_name, start, end):
        self.cur.execute(self.subchart_query_generator(table_name), (start, end))
        return self.cur.fetchall()

    def summary_chart(self, start_date, end_date):
        start, end, months = self._month_range(start_date, end_date)

        income_data = self.fetch_data_as_dict("budgets.income", start, end)
        expense_data = self.fetch_data_as_dict("budgets.expenses", start, end)
        debt_data = self.fetch_data_as_dict("budgets.debt", start, end)
        savings_data = self.fetch_data_as_dict("budgets.savings", start, end)

        result = []
        for mon_str, year, month in months:
            key = (year, month)
            result.append({
                "month": mon_str + "-" + str(year),
                "income": float(income_data.get(key, 0)),
                "expense": float(expense_data.get(key, 0)),
                "debt": float(debt_data.get(key, 0)),
                "savings": float(savings_data.get(key, 0))
            })

        return result

    def sub_charts(self, start_date, end_date):
        start, end, _months = self._month_range(start_date, end_date)

        income_data = self.fetch_sub_chart_data("budgets.income", start, end)
        expense_data = self.fetch_sub_chart_data("budgets.expenses", start, end)
        debt_data = self.fetch_sub_chart_data("budgets.debt", start, end)
        savings_data = self.fetch_sub_chart_data("budgets.savings", start, end)

        return {
            'income': [{"category": row[0], "amount": float(row[1])} for row in income_data],
            'expense': [{"category": row[0], "amount": float(row[1])} for row in expense_data],
            'debt': [{"category": row[0], "amount": float(row[1])} for row in debt_data],
            'savings': [{"category": row[0], "amount": float(row[1])} for row in savings_data],
        }