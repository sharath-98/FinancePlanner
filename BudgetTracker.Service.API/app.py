# FILE: BudgetTracker.Service.API/app.py  (REPLACE existing file)
import json
from Utils.DebtService import DebtService
import psycopg2
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from Database.DBConnector import DBConnector
from Utils.AuthUtil import (
    DUMMY_HASH,
    LoginThrottle,
    create_token,
    load_or_create_secret,
    read_token,
    verify_password,
)
from Utils.BudgetRepository import BudgetRepository
from Utils.InsightsService import InsightsService
from Utils.RequestUtil import (
    ApiError,
    json_body,
    parse_client_date,
    parse_text,
    parse_year,
    require_field,
)

app = Flask(__name__)
CORS(app)

with open('appsettings.json') as config_file:
    app.config.update(json.load(config_file))

# Login. Requiring it is switched on with  "auth_required": true  in appsettings.json.
# Optional there too: "auth_secret" (32+ characters) and "auth_token_days" (default 30).
auth_secret = load_or_create_secret(app.config.get('auth_secret'))
login_throttle = LoginThrottle()
AUTH_OPEN_ENDPOINTS = {'get_handshake', 'login'}


# ----------------------------------------------------------------------
# One database connection per request, always closed at the end
# ----------------------------------------------------------------------

def get_repo():
    """Repository for this request. The connection opens on first use."""
    if 'repo' not in g:
        db = DBConnector()
        conn = db.get_connection(app.config['db_conn'])
        g.db = db
        g.repo = BudgetRepository(db.get_cursor(), conn)
    return g.repo


@app.teardown_appcontext
def close_db(_error):
    db = g.pop('db', None)
    g.pop('repo', None)
    if db is not None:
        try:
            # Anything not committed by now is discarded.
            db.close()
        except Exception:
            app.logger.exception("Could not close the database connection")


# ----------------------------------------------------------------------
# Errors: always JSON with a real HTTP status, never "success" by mistake
# ----------------------------------------------------------------------

@app.errorhandler(ApiError)
def handle_api_error(error):
    return jsonify({"error": error.message}), error.status


@app.errorhandler(psycopg2.OperationalError)
def handle_database_unreachable(_error):
    app.logger.exception("Cannot reach the database")
    return jsonify({
        "error": "Cannot reach the database. Check that PostgreSQL is running and that "
                 "the settings in appsettings.json are correct."
    }), 503


@app.errorhandler(psycopg2.Error)
def handle_database_error(_error):
    app.logger.exception("Database error")
    return jsonify({"error": "The database could not complete the request. See the API log for details."}), 500


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    if isinstance(error, HTTPException):
        return error
    app.logger.exception("Unhandled error")
    return jsonify({"error": "Something went wrong in the API. See the API log for details."}), 500


# ----------------------------------------------------------------------
# Login: when "auth_required" is true, every route except /login and /getHandshake needs a token
# ----------------------------------------------------------------------

@app.before_request
def require_login():
    if not app.config.get('auth_required', False):
        return None
    if request.method == 'OPTIONS' or request.endpoint in AUTH_OPEN_ENDPOINTS:
        return None

    header = request.headers.get('Authorization', '')
    payload = read_token(header[7:] if header.startswith('Bearer ') else '', auth_secret)
    if payload is None:
        raise ApiError("Please sign in.", 401)
    g.current_user = {'id': payload['uid'], 'username': payload['u']}
    return None


@app.route('/login', methods=['POST'])
def login():
    body = json_body()
    username = parse_text(require_field(body, 'username'), 'username', 100)
    password = require_field(body, 'password')
    if not isinstance(password, str):
        raise ApiError("password must be text.")

    key = username.lower()
    if login_throttle.is_blocked(key):
        raise ApiError("Too many failed attempts. Try again in a few minutes.", 429)

    user = get_repo().get_user_for_login(username)
    stored = user[2] if user and user[2] else DUMMY_HASH
    matches = verify_password(password, stored)
    if not (matches and user and user[2]):
        login_throttle.record_failure(key)
        raise ApiError("Incorrect username or password.", 401)

    login_throttle.clear(key)
    token, expires = create_token(user[0], user[1], auth_secret, app.config.get('auth_token_days', 30))
    return jsonify({"token": token, "expires_at": expires, "user": {"id": user[0], "username": user[1]}})


@app.route('/me', methods=['GET'])
def me():
    """Who is signed in. Lets the UI skip the login page when login is not required."""
    if not app.config.get('auth_required', False):
        return jsonify({"auth_required": False})
    return jsonify({"auth_required": True, "user": g.current_user})


# ----------------------------------------------------------------------
# Routes (same paths, methods and answers as before)
# ----------------------------------------------------------------------

@app.route('/getHandshake', methods=['GET'])
def get_handshake():
    return "Test Successful"


@app.route('/updateSrc', methods=['POST'])
def handle_update_src_data():
    data = require_field(json_body(), 'data')
    get_repo().update_src_data(data)
    return jsonify({})


@app.route('/plannerMonthActivity', methods=['POST'])
def planner_month_activity():
    """New, read-only. Same 'data' object as /updateSrc (amount not needed)."""
    data = require_field(json_body(), 'data')
    return jsonify(get_repo().get_month_activity(data))


@app.route('/searchTransactions', methods=['POST'])
def search_transactions():
    """New, read-only. Newest entries first; {"query": "...", "limit": 25} are both optional.
    {"id": 12} returns just that transaction."""
    body = json_body()
    return jsonify(get_repo().search_transactions(body.get('query'), body.get('limit'), body.get('id')))


@app.route('/updateTransaction', methods=['POST'])
def update_transaction():
    """New. Changes one transaction; the planner is corrected by the difference."""
    get_repo().update_transaction(require_field(json_body(), 'transaction'))
    return jsonify({"msg": "success"})


@app.route('/deleteTransaction', methods=['POST'])
def delete_transaction():
    """New. Deletes one transaction; its amount comes back out of the planner."""
    get_repo().delete_transaction(require_field(json_body(), 'id'))
    return jsonify({"msg": "success"})


@app.route('/getsubcategory', methods=['POST'])
def sub_category():
    category_id = require_field(json_body(), 'category_id')
    res = get_repo().get_subcategory(category_id)

    if res is None:
        return jsonify({})

    return jsonify(res)


@app.route('/savesubcategory', methods=['POST'])
def save_sub_category():
    body = json_body()
    category_id = require_field(body, 'category_id')
    merchant = require_field(body, 'merchant')

    res = get_repo().save_subcategory(category_id, merchant)

    if res is None:
        return jsonify({})

    return jsonify(res.to_dict(orient='records'))


@app.route('/subCharts', methods=['POST'])
def sub_charts():
    body = json_body()
    start_date = parse_client_date(require_field(body, 'start'), 'start')
    end_date = parse_client_date(require_field(body, 'end'), 'end')

    return jsonify(get_repo().sub_charts(start_date, end_date))


@app.route('/summaryChart', methods=['POST'])
def summary_chart():
    body = json_body()
    start_date = parse_client_date(require_field(body, 'start'), 'start')
    end_date = parse_client_date(require_field(body, 'end'), 'end')

    return jsonify(get_repo().summary_chart(start_date, end_date))


@app.route('/insights', methods=['POST'])
def insights():
    """New, read-only. Same {"start", "end"} as /summaryChart. Savings rate, year over year,
    unusual spending and large purchases for the last month of that range."""
    body = json_body()
    start_date = parse_client_date(require_field(body, 'start'), 'start')
    end_date = parse_client_date(require_field(body, 'end'), 'end')

    return jsonify(InsightsService(get_repo().cur).build(start_date, end_date))


@app.route('/monthOverMonth', methods=['POST'])
def month_over_month():
    """New, read-only. {"end": date, "complete_only": false}: the month containing `end`
    against the month before, expense movers, and a 12-month trend."""
    body = json_body()
    end_date = parse_client_date(require_field(body, 'end'), 'end')
    complete_only = body.get('complete_only', False)
    if not isinstance(complete_only, bool):
        raise ApiError("complete_only must be true or false.")

    return jsonify(InsightsService(get_repo().cur).month_over_month(end_date, complete_only))


@app.route('/saveTransaction', methods=['POST'])
def save_transaction():
    transaction = require_field(json_body(), 'transaction')
    get_repo().save_transaction(transaction)
    return jsonify({"msg": "success"})


@app.route('/transactions', methods=['POST'])
def get_yearly_transaction():
    year = parse_year(require_field(json_body(), 'year'))
    res = get_repo().get_yearly_transaction(year)

    if res is None:
        return jsonify([])

    return jsonify(res.to_dict(orient='records'))


@app.route('/categories', methods=['GET'])
def get_categories():
    res, types = get_repo().get_categories()

    return jsonify({
        "categories": res.to_dict(orient='records'),
        "types": types
    })


@app.route('/saveCategory', methods=['POST'])
def save_category():
    """New. Adds a category: {"name": "Pets", "type": "expense"}."""
    body = json_body()
    user = g.get('current_user')
    created = get_repo().save_category(
        require_field(body, 'name'), require_field(body, 'type'), user['id'] if user else None
    )
    return jsonify(created), 201


@app.route('/categoryMappings', methods=['GET'])
def category_mappings():
    """New, read-only. Every category with its saved merchants."""
    return jsonify(get_repo().get_category_mappings())


@app.route('/income', methods=['POST'])
def get_income():
    year = parse_year(require_field(json_body(), 'year'))
    res = get_repo().get_income(year)

    if res is None:
        return jsonify([])

    return jsonify(res.to_dict(orient='records'))


@app.route('/users', methods=['GET'])
def get_users():
    res = get_repo().get_users()

    if res is None:
        return jsonify([])

    return jsonify(res.to_dict(orient='records'))


@app.route('/expenses', methods=['POST'])
def get_expenses():
    year = parse_year(require_field(json_body(), 'year'))
    res = get_repo().get_expenses(year)

    if res is None:
        return jsonify([])

    return jsonify(res.to_dict(orient='records'))


@app.route('/debt', methods=['POST'])
def get_debt():
    year = parse_year(require_field(json_body(), 'year'))
    res = get_repo().get_debts(year)

    if res is None:
        return jsonify([])

    return jsonify(res.to_dict(orient='records'))


@app.route('/savings', methods=['POST'])
def get_savings():
    year = parse_year(require_field(json_body(), 'year'))
    res = get_repo().get_savings(year)

    if res is None:
        return jsonify([])

    return jsonify(res.to_dict(orient='records'))

# ----------------------------------------------------------------------
# Debt payoff tracking (Phase 5). New routes only; /debt is unchanged.
# ----------------------------------------------------------------------

def debt_service():
    repo = get_repo()
    return DebtService(repo.cur, repo.conn)


@app.route('/debtSummary', methods=['GET'])
def debt_summary():
    """Every debt category: paid so far, balance left, % paid off, payoff month."""
    return jsonify(debt_service().summary())


@app.route('/debtHistory', methods=['POST'])
def debt_history():
    """{"category_id": 54}: month by month paid, principal, interest, balance."""
    return jsonify(debt_service().history(require_field(json_body(), 'category_id')))


@app.route('/debtPayoffScenario', methods=['POST'])
def debt_payoff_scenario():
    """{"category_id": 54, "extra_monthly": 200, "lump_sum": 0}: what paying more saves."""
    body = json_body()
    return jsonify(debt_service().payoff_scenario(
        require_field(body, 'category_id'), body.get('extra_monthly'), body.get('lump_sum')
    ))


@app.route('/debtAccounts', methods=['GET'])
def debt_accounts():
    """Loan settings and statement balances, one entry per debt category."""
    return jsonify(debt_service().accounts())


@app.route('/saveDebtAccount', methods=['POST'])
def save_debt_account():
    """{"account": {...}}: creates or updates the loan for one debt category."""
    return jsonify(debt_service().save_account(require_field(json_body(), 'account')))


@app.route('/saveDebtBalance', methods=['POST'])
def save_debt_balance():
    """{"category_id": 54, "date": "2026-11-22", "balance": 4577.54, "note": "..."}."""
    return jsonify(debt_service().save_statement(json_body()))