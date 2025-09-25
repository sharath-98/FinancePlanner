CREATE OR REPLACE FUNCTION get_monthly_savings(year_param INT)
RETURNS TABLE(category TEXT, month INT, total NUMERIC)
LANGUAGE sql
AS $$
  SELECT
    c.name AS category,
    EXTRACT(MONTH FROM i.date) AS month,
    SUM(i.amount) AS total
  FROM budgets.savings i
  JOIN budgets.categories c ON i.category_id = c.id
  WHERE EXTRACT(YEAR FROM i.date) = year_param
  GROUP BY c.name, month
  ORDER BY c.name, month;
$$;

select * from get_monthly_savings(2025);