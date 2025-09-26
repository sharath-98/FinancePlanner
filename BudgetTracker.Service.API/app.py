from flask import Flask, jsonify, make_response
import json
from flask_cors import CORS
from Database.DBConnector import DBConnector
from Utils.BudgetRepository import BudgetRepository
from flask import request
from datetime import datetime

app = Flask(__name__)
CORS(app)

with open('appsettings.json') as config_file:
    app.config.update(json.load(config_file))


@app.route('/getHandshake', methods=['GET'])
def get_handshake():
    return "Test Successful"


@app.route('/updateSrc', methods=['POST'])
def handle_update_src_data():
    data = request.get_json()['data']
    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur, db_conn)
    res = _budgetRepo.update_src_data(data)
    if res is None:
        return make_response(jsonify({}))

    return jsonify({"msg": "success"})

@app.route('/summaryChart', methods=['POST'])
def summary_chart():
    startDate = request.get_json()['start']
    endDate = request.get_json()['end']

    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur, db_conn)
    res = _budgetRepo.summary_chart(startDate, endDate)

    if res is None:
        return make_response(jsonify({}))

    return jsonify(res)


@app.route('/saveTransaction', methods=['POST'])
def save_transaction():
    transaction = request.get_json()['transaction']
    transaction["created_date"] = datetime.now()

    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur, db_conn)
    res = _budgetRepo.save_transaction(transaction)

    if res is None:
        return make_response(jsonify({}))

    return jsonify({"msg": "success"})

@app.route('/transactions', methods=['POST'])
def get_yearly_transaction():
    year = request.get_json()['year']

    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur)
    res = _budgetRepo.get_yearly_transaction(year)


    if res is None:
        return make_response(jsonify([]))

    response = res.to_dict(orient='records')
    return jsonify(response)

@app.route('/categories', methods=['GET'])
def get_categories():
    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur)
    res, types = _budgetRepo.get_categories()

    if res is None:
        return make_response(jsonify([]))

    response = {
        "categories": res.to_dict(orient='records'),
        "types": types
    }
    return jsonify(response )

@app.route('/income', methods=['POST'])
def get_income():
    year = request.get_json()['year']

    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur)
    res = _budgetRepo.get_income(year)

    if res is None:
        return make_response(jsonify([]))

    response = res.to_dict(orient='records')
    return jsonify(response)

@app.route('/expenses', methods=['POST'])
def get_expenses():
    year = request.get_json()['year']

    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur)
    res = _budgetRepo.get_expenses(year)

    if res is None:
        return make_response(jsonify([]))

    response = res.to_dict(orient='records')
    return jsonify(response)

@app.route('/debt', methods=['POST'])
def get_debt():
    year = request.get_json()['year']

    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur)
    res = _budgetRepo.get_debts(year)

    if res is None:
        return make_response(jsonify([]))

    response = res.to_dict(orient='records')
    return jsonify(response)

@app.route('/savings', methods=['POST'])
def get_savings():
    year = request.get_json()['year']

    db_conn = DBConnector()
    db_config = app.config['db_conn']
    db_conn.get_connection(db_config)
    cur = db_conn.get_cursor()

    _budgetRepo = BudgetRepository(cur)
    res = _budgetRepo.get_savings(year)

    if res is None:
        return make_response(jsonify([]))

    response = res.to_dict(orient='records')
    return jsonify(response)