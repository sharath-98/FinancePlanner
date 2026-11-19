# FILE: BudgetTracker.Service.API/Database/DBConnector.py  (REPLACE existing file)
import psycopg2


class DBConnector:
    """Opens one PostgreSQL connection.

    Changes are only saved when commit() is called on the connection. If the
    request fails before that, closing the connection discards them, so a
    save is all-or-nothing.
    """

    def __init__(self):
        self.connection = None

    def get_connection(self, db_config):
        if self.connection is None:
            # Raises psycopg2.OperationalError when the database cannot be reached;
            # app.py turns that into a clear error response.
            self.connection = psycopg2.connect(
                host=db_config['host'],
                database=db_config['database'],
                user=db_config['user'],
                password=db_config['password'],
                port=db_config['port'],
                connect_timeout=db_config.get('connect_timeout', 5),
            )
            self.connection.autocommit = False
        return self.connection

    def get_cursor(self):
        return self.connection.cursor()

    def close(self):
        if self.connection is not None:
            try:
                self.connection.close()
            finally:
                self.connection = None