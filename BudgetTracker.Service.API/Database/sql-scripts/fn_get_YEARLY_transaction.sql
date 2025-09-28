CREATE OR REPLACE FUNCTION get_yearly_transaction(year_param INT)
RETURNS TABLE(id INT, date Date, type TEXT, category TEXT, amount NUMERIC, details TEXT, merchant TEXT)
LANGUAGE sql
AS $$
  SELECT t.id, t.date, t.type, c.name AS category, t.amount, t.details, t.merchant
  FROM budgets.transactions t
  JOIN budgets.categories c ON t.category = c.id
  WHERE EXTRACT(YEAR FROM t.date) = year_param
  ORDER BY t.date, t.type
$$;
commit;

select * from get_yearly_transaction(2025);

