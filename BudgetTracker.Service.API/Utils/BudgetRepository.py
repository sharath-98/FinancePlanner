import psycopg2
from flask import make_response
import calendar
import pandas as pd
from datetime import datetime

class BudgetRepository:
    def __init__(self, cur = None, conn = None):
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
        df_final['Total'] = df_final.loc[:, 'Jan':].sum(axis=1)

        # Calculate column-wise total (sum for each month plus total)
        total_row = df_final.loc[:, 'Jan':].sum(axis=0)
        total_row[category] = 'Total'  # Label for total row

        # Append the total row to the DataFrame
        df_final = pd.concat([df_final, total_row.to_frame().T], ignore_index=True)

        return df_final


    def get_income(self, year):
        try:
            self.cur.execute(f"SELECT * from budgets.get_monthly_income({year})")
            rows = self.cur.fetchall()

            # Close the cursor and connection
            self.cur.close()

            if len(rows) > 0:
                df_final = self.income_expense_saving_extractor(rows, "Income")
                return df_final
            else:
                return None

        except psycopg2.Error as e:
            return make_response(str(e))


    def get_debts(self, year):
        try:
            self.cur.execute(f"SELECT * from budgets.get_monthly_debts({year})")
            rows = self.cur.fetchall()

            # Close the cursor and connection
            self.cur.close()

            if len(rows) > 0:
                df_final = self.income_expense_saving_extractor(rows, "Debts")
                return df_final
            else:
                return None

        except psycopg2.Error as e:
            return make_response(str(e))


    def get_expenses(self, year):
        try:
            self.cur.execute(f"SELECT * from budgets.get_monthly_expense({year})")
            rows = self.cur.fetchall()

            # Close the cursor and connection
            self.cur.close()

            if len(rows) > 0:
                df_final = self.income_expense_saving_extractor(rows, "Expenses")
                return df_final
            else:
                return None

        except psycopg2.Error as e:
            return make_response(str(e))


    def get_categories(self):
        try:
            self.cur.execute(f"SELECT * from budgets.categories")
            rows = self.cur.fetchall()

            data = [
                {"id": row[0], "type": row[2], "name": row[3]}
                for row in rows
            ]

            df_final = pd.DataFrame(data)
            df_final = df_final.fillna(0)

            self.cur.execute(f"SELECT distinct(type) from budgets.categories")
            types = self.cur.fetchall()
            self.cur.close()

            types = [t[0] for t in types]

            return df_final, types

        except psycopg2.Error as e:
            return make_response(str(e))


    def save_transaction(self, transaction):
        try:
            query = f"INSERT INTO budgets.transactions(user_id, date, type, category, amount, details, created_at) values ({transaction['paidby']},'{transaction['date']}','{transaction['type']}',{transaction['category']['id']}, {transaction['amount']},'{transaction['details']}','{transaction['created_date']}')"

            self.cur.execute(query)

            dt_object = datetime.strptime(transaction['date'], "%Y-%m-%dT%H:%M:%S.%fZ")

            query = f"SELECT id, amount FROM budgets.expenses WHERE category_id = {transaction['category']['id']} AND EXTRACT(MONTH FROM date) = {dt_object.month}  AND EXTRACT(YEAR FROM date) = {dt_object.year}"

            self.cur.execute(query)
            row = self.cur.fetchone()

            if row:
                expense_id, existing_amount = row
                update_sql = "UPDATE budgets.expenses SET amount = amount + %s WHERE id=%s"
                self.cur.execute(update_sql, (transaction['amount'], expense_id))
            else:
                insert_sql = """INSERT INTO budgets.expenses (category_id, amount, date)
                                VALUES (%s, %s, %s)"""
                self.cur.execute(insert_sql, (transaction['category']['id'], transaction['amount'], transaction['date']))

            # Close the cursor and connection
            self.cur.close()

            return 1

        except psycopg2.Error as e:
            return make_response(str(e))


    def get_yearly_transaction(self, year):
        try:
            self.cur.execute(f"select * from budgets.get_yearly_transaction({year})")
            rows = self.cur.fetchall()

            data = [
                {"id": row[0], "date": row[1], "type": row[2], "category": row[3], "amount": row[4], "details": row[5]}
                for row in rows
            ]


            # Close the cursor and connection
            self.cur.close()

            df_final = pd.DataFrame(data)
            df_final['date'] = pd.to_datetime(df_final['date'])
            df_final['date'] = df_final['date'].dt.strftime('%m-%d-%Y')

            df_final = df_final.fillna(0)

            if len(df_final) > 0:
                return df_final
            else:
                return None

        except psycopg2.Error as e:
            return make_response(str(e))


    def get_savings(self, year):
        try:
            self.cur.execute(f"SELECT * from budgets.get_monthly_savings({year})")
            rows = self.cur.fetchall()

            # Close the cursor and connection
            self.cur.close()

            if len(rows) > 0:
                df_final = self.income_expense_saving_extractor(rows, "Savings")
                return df_final
            else:
                return None

        except psycopg2.Error as e:
            return make_response(str(e))