import psycopg2
from flask import make_response
import os

class DBConnector:
    def __init__(self):
        self.connection = None

    def get_cursor(self):
        return self.connection.cursor()

    def get_connection(self, db_config = None):
        if self.connection is None:
            try:
                self.connection = psycopg2.connect(
                    host=db_config['host'],
                    database=db_config['database'],
                    user=db_config['user'],
                    password=db_config['password'],
                    port=db_config['port']
                )
                self.connection.autocommit = True

            except (Exception, psycopg2.DatabaseError) as error:
                make_response("Error while connecting to PostgreSQL", 500)

