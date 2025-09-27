import psycopg2
from flask import make_response
import calendar
import pandas as pd
from datetime import datetime

from Utils.HelperUtil import HelperUtil


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


    def summary_chart(self, startDate, endDate):
        try:
            help_util = HelperUtil()

            start_month = datetime.strptime(startDate, "%Y-%m-%dT%H:%M:%S.%fZ").month
            start_year = datetime.strptime(startDate, "%Y-%m-%dT%H:%M:%S.%fZ").year
            end_month = datetime.strptime(endDate, "%Y-%m-%dT%H:%M:%S.%fZ").month
            end_year = datetime.strptime(endDate, "%Y-%m-%dT%H:%M:%S.%fZ").year


            start = datetime(start_year, start_month, 1)
            end = help_util.get_last_day_of_month(end_year, end_month)

            months = help_util.month_iter(start, end)

            income_data = self.fetch_data_as_dict("budgets.income", start, end)
            expense_data = self.fetch_data_as_dict("budgets.expenses", start, end)
            debt_data = self.fetch_data_as_dict("budgets.debt", start, end)
            savings_data = self.fetch_data_as_dict("budgets.savings", start, end)

            result = []
            for mon_str, year, month in months:
                key = (year, month)
                result.append({
                    "month": mon_str+"-"+str(year),
                    "income": float(income_data.get(key, 0)),
                    "expense": float(expense_data.get(key, 0)),
                    "debt": float(debt_data.get(key, 0)),
                    "savings": float(savings_data.get(key, 0))
                })

            return result

        except psycopg2.Error as e:
            return make_response(str(e))


    def summary_chart_query_generator(self, table_name):
        query = f"SELECT EXTRACT(YEAR FROM date) as year, EXTRACT(MONTH FROM date) as month, SUM(amount) as total FROM {table_name} WHERE date BETWEEN %s AND %s GROUP BY year, month"

        return query

    def subchart_query_generator(self, table_name):
        query = f"SELECT c.name as category, SUM(amount) as amount FROM {table_name} i JOIN budgets.categories c ON i.category_id = c.id WHERE date BETWEEN %s AND %s GROUP BY i.category_id, c.name"

        return query


    def fetch_data_as_dict(self, table_name, start, end):
        query = self.summary_chart_query_generator(table_name)
        self.cur.execute(query, (start, end))
        return {(int(row[0]), int(row[1])): row[2] for row in self.cur.fetchall()}


    def fetch_sub_chart_data(self, table_name, start, end):
        query = self.subchart_query_generator(table_name)
        self.cur.execute(query, (start, end))
        return self.cur.fetchall()


    def sub_charts(self, startDate, endDate):
        help_util = HelperUtil()

        start_month = datetime.strptime(startDate, "%Y-%m-%dT%H:%M:%S.%fZ").month
        start_year = datetime.strptime(startDate, "%Y-%m-%dT%H:%M:%S.%fZ").year
        end_month = datetime.strptime(endDate, "%Y-%m-%dT%H:%M:%S.%fZ").month
        end_year = datetime.strptime(endDate, "%Y-%m-%dT%H:%M:%S.%fZ").year

        start = datetime(start_year, start_month, 1)
        end = help_util.get_last_day_of_month(end_year, end_month)

        months = help_util.month_iter(start, end)

        income_data = self.fetch_sub_chart_data("budgets.income", start, end)
        expense_data = self.fetch_sub_chart_data("budgets.expenses", start, end)
        debt_data = self.fetch_sub_chart_data("budgets.debt", start, end)
        savings_data = self.fetch_sub_chart_data("budgets.savings", start, end)

        result = {
            'income': [{"category": row[0], "amount": float(row[1])} for row in income_data],
            'expense': [{"category": row[0], "amount": float(row[1])} for row in expense_data],
            'debt': [{"category": row[0], "amount": float(row[1])} for row in debt_data],
            'savings': [{"category": row[0], "amount": float(row[1])} for row in savings_data],
        }

        return result



    def update_src_data(self, data):
        try:
            table_name = ""
            if data['type'] == 'Expenses':
                table_name = "budgets.expenses"
            elif data['type'] == 'Income':
                table_name = "budgets.income"
            elif data['type'] == 'Debts':
                table_name = "budgets.debt"
            else:
                table_name = "budgets.savings"

            month = datetime.strptime(data['month'],'%b').month
            cat_query = f"select id from budgets.categories where name='{data['category']}'"
            self.cur.execute(cat_query)
            category_id = self.cur.fetchone()[0]
            print(category_id)

            query = f"SELECT id, amount FROM {table_name} WHERE category_id = {category_id} AND EXTRACT(MONTH FROM date) = {month}  AND EXTRACT(YEAR FROM date) = {data['year']}"

            self.cur.execute(query)
            row = self.cur.fetchone()

            if row:
                data_id, existing_amount = row
                print(data_id)
                update_sql = f"UPDATE {table_name} SET amount = %s WHERE id=%s"
                self.cur.execute(update_sql, (data['amount'], data_id))
            else:
                date = "" + str(data['year']) + "-" + str(month) + "-01"
                insert_sql = f"INSERT INTO {table_name} (category_id, amount, date) VALUES (%s, %s, %s)"
                self.cur.execute(insert_sql, (category_id, data['amount'], date))

        except psycopg2.Error as e:
            return make_response(str(e))


    def on_transaction_update_update_src(self, transaction):
        try:

            dt_object = datetime.strptime(transaction['date'], "%Y-%m-%dT%H:%M:%S.%fZ")
            table_name = ""
            if transaction['type'] == 'expense':
                table_name = "budgets.expenses"
            elif transaction['type'] == 'income':
                table_name = "budgets.income"
            elif transaction['type'] == 'debt':
                table_name = "budgets.debt"
            else:
                table_name = "budgets.savings"

            query = f"SELECT id, amount FROM {table_name} WHERE category_id = {transaction['category']['id']} AND EXTRACT(MONTH FROM date) = {dt_object.month}  AND EXTRACT(YEAR FROM date) = {dt_object.year}"
            self.cur.execute(query)
            row = self.cur.fetchone()

            # Check if a row with the same month and year for a category already exists
            if row:
                expense_id, existing_amount = row
                update_sql = f"UPDATE {table_name} SET amount = amount + %s WHERE id=%s"
                self.cur.execute(update_sql, (transaction['amount'], expense_id))
            else:
                insert_sql = f"INSERT INTO {table_name} (category_id, amount, date) VALUES (%s, %s, %s)"
                self.cur.execute(insert_sql, (transaction['category']['id'], transaction['amount'], transaction['date']))

        except psycopg2.Error as e:
            return make_response(str(e))


    def save_transaction(self, transaction):
        try:
            query = f"INSERT INTO budgets.transactions(user_id, date, type, category, amount, details, created_at) values ({transaction['paidby']},'{transaction['date']}','{transaction['type']}',{transaction['category']['id']}, {transaction['amount']},'{transaction['details']}','{transaction['created_date']}')"

            self.cur.execute(query)

            self.on_transaction_update_update_src(transaction)

            # Close the cursor and connection
            self.cur.close()

            return 1

        except psycopg2.Error as e:
            return make_response(str(e))


    def save_subcategory(self, category_id, merchant):
        try:
            query = f"INSERT INTO budgets.subcategory(category_id, merchant) values ({category_id},'{merchant}')"
            self.cur.execute(query)

            self.cur.execute(f"select * from budgets.subcategory where category_id = {category_id}")
            rows = self.cur.fetchall()

            data = [
                {"id": row[0], "category_id": row[1], "merchant": row[2]}
                for row in rows
            ]

            # Close the cursor and connection
            self.cur.close()

            df_final = pd.DataFrame(data)
            df_final = df_final.fillna(0)

            if len(df_final) > 0:
                return df_final
            else:
                return None

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


    def get_subcategory(self, category_id):
        try:
            self.cur.execute(f"select * from budgets.subcategory where category_id = {category_id}")
            rows = self.cur.fetchall()

            data = [
                {"id": row[0], "category_id": row[1], "merchant": row[2]}
                for row in rows
            ]


            # Close the cursor and connection
            self.cur.close()

            df_final = pd.DataFrame(data)
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