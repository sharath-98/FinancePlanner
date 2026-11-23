# FILE: BudgetTracker.Service.API/refresh_prices.py  (NEW file)
"""Fetches the latest prices for everything held. Run by launchd on a schedule, or by hand:

    cd BudgetTracker.Service.API && python3 refresh_prices.py

Reads appsettings.json (db_conn) like the Flask app; the Finnhub key comes from secrets.json.
Prints one line per run, so the launchd log shows what happened.
"""
import json
import os
import sys
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from Database.DBConnector import DBConnector  # noqa: E402
from Utils.PriceService import PriceService   # noqa: E402


def main():
    with open(os.path.join(HERE, "appsettings.json")) as f:
        config = json.load(f)
    db = DBConnector()
    try:
        conn = db.get_connection(config["db_conn"])
        result = PriceService(db.get_cursor(), conn, config).refresh(force="--force" in sys.argv)
    finally:
        db.close()
    failed = ", ".join(f"{f['symbol']} ({f['reason']})" for f in result["failed"]) or "none"
    print(f"{datetime.now():%Y-%m-%d %H:%M} updated {len(result['updated'])}: {' '.join(result['updated'])}"
          f" | skipped {len(result['skipped_recent'])} | failed: {failed}")
    return 1 if result["failed"] and not result["updated"] else 0


if __name__ == "__main__":
    sys.exit(main())
