CREATE TABLE budgets.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(200) UNIQUE NOT NULL
);

CREATE TABLE budgets.categories (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES budgets.users(id),
    type VARCHAR(20) CHECK (type IN ('income', 'expense', 'saving', 'debt')),
    name VARCHAR(100) NOT NULL
);

CREATE TABLE budgets.income (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES budgets.users(id),
    category_id INTEGER REFERENCES budgets.categories(id),
    amount NUMERIC(12,2) NOT NULL,
    date DATE NOT NULL,
    details VARCHAR(255)
);

CREATE TABLE budgets.expenses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES budgets.users(id),
    category_id INTEGER REFERENCES budgets.categories(id),
    amount NUMERIC(12,2) NOT NULL,
    date DATE NOT NULL,
    details VARCHAR(255)
);

CREATE TABLE budgets.savings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES budgets.users(id),
    category_id INTEGER REFERENCES budgets.categories(id),
    amount NUMERIC(12,2) NOT NULL,
    date DATE NOT NULL,
    details VARCHAR(255)
);

CREATE TABLE budgets.debt (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES budgets.users(id),
    category_id INTEGER REFERENCES budgets.categories(id),
    amount NUMERIC(12,2) NOT NULL,
    date DATE NOT NULL,
    details VARCHAR(255)
);

CREATE TABLE budgets.transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES budgets.users(id),
    date DATE NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense', 'saving')),
    category VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    details VARCHAR(255),
    balance NUMERIC(12,2),
    effective_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
