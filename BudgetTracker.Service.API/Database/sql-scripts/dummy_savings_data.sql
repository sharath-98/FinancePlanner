INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 23, 3100, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 24, 100, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 25, 70, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 26, 70, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (2, 27, 3500, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (2, 28, 100, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (2, 29, 200, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 30, 100, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 31, 0, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (2, 32, 100, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 33, 0, '1-Jan-2025');
INSERT INTO budgets.savings (user_id, category_id, amount, date) values (1, 34, 0, '1-Jan-2025');
commit;

select * from budgets.savings;