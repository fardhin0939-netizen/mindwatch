import os
import sqlite3
from datetime import datetime

import os


BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _db_path():
    """Resolve the SQLite database file path."""
    path = os.environ.get("MINDWATCH_DB_FILE")
    if not path:
        path = os.path.join(BASE_DIR, "mindwatch.db")
    return os.path.abspath(path)


def _mysql_date_format(value, fmt):
    """Minimal emulation of MySQL's DATE_FORMAT() for the formats used.

    The app only formats timestamps as '%d %b %Y, %h:%i %p', so this
    subset is enough to keep the displayed messages unchanged.
    """

    if value is None:
        return None

    try:
        if isinstance(value, str):
            dt = datetime.strptime(
                value[:19], "%Y-%m-%d %H:%M:%S"
            )
        else:
            dt = value
    except Exception:
        return value

    day = dt.strftime("%d")
    month = dt.strftime("%b")
    year = dt.strftime("%Y")
    hour12 = dt.strftime("%I")
    minute = dt.strftime("%M")
    ampm = "AM" if dt.hour < 12 else "PM"

    return f"{day} {month} {year}, {hour12}:{minute} {ampm}"


class _SQLiteCursor(sqlite3.Cursor):
    """sqlite3 cursor that accepts MySQL-style ``%s`` placeholders
    and returns plain ``dict`` rows (like MySQL dictionary cursors)."""

    def execute(self, sql, parameters=None):
        if parameters is None:
            return sqlite3.Cursor.execute(self, sql)
        return sqlite3.Cursor.execute(
            self, sql.replace("%s", "?"), parameters
        )

    def executemany(self, sql, parameters):
        return sqlite3.Cursor.executemany(
            self, sql.replace("%s", "?"), parameters
        )

    def _as_dict(self, row):
        if isinstance(row, sqlite3.Row):
            return dict(row)
        return row

    def fetchone(self):
        return self._as_dict(sqlite3.Cursor.fetchone(self))

    def fetchmany(self, size):
        rows = sqlite3.Cursor.fetchmany(self, size)
        return [self._as_dict(r) for r in rows]

    def fetchall(self):
        rows = sqlite3.Cursor.fetchall(self)
        return [self._as_dict(r) for r in rows]


class _SQLiteConnection(sqlite3.Connection):
    """Connection that returns the ``%s``-compatible cursors."""

    def cursor(self, factory=_SQLiteCursor, dictionary=False):
        return super().cursor(factory=factory)

    def execute(self, sql, parameters=None):
        return self.cursor().execute(sql, parameters)


def get_db_connection():
    """Open a SQLite connection (MySQL-style ``%s`` placeholders)."""

    connection = sqlite3.connect(
        _db_path(),
        timeout=30,
        check_same_thread=False,
        factory=_SQLiteConnection,
    )
    connection.row_factory = sqlite3.Row
    connection.create_function(
        "DATE_FORMAT", 2, _mysql_date_format
    )

    return connection


def _table_exists(connection, table_name):
    """Check whether a table exists (cross-version SQLite)."""

    try:
        cursor = connection.execute(
            "SELECT 1 FROM sqlite_master "
            "WHERE type = 'table' AND name = ?",
            (table_name,)
        )
        return cursor.fetchone() is not None
    except Exception:
        return False


def _table_columns(connection, table_name):
    """Return the set of existing column names for a table."""

    try:
        return {row["name"] for row in connection.execute(
            f"PRAGMA table_info({table_name})"
        )}
    except Exception:
        return set()


def _ensure_column(connection, table_name, column_name, definition):
    """Add a column if it is missing (safe migration)."""

    if not _table_exists(connection, table_name):
        return

    try:
        if column_name not in _table_columns(connection, table_name):
            connection.execute(
                f"ALTER TABLE {table_name} "
                f"ADD COLUMN {column_name} {definition}"
            )
    except Exception:
        # Migration is best-effort; do not break app startup.
        pass


def init_db():
    """Create the required tables if they do not already exist."""

    connection = get_db_connection()

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL
        )
        """
    )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assessments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INT NOT NULL,
            journal_text TEXT,
            heart_rate FLOAT,
            sleep_hours FLOAT,
            physical_activity FLOAT,
            screen_time FLOAT,
            social_interactions FLOAT,
            stress_level FLOAT,
            wellness_score FLOAT,
            risk_level VARCHAR(50),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS consent (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INT NOT NULL UNIQUE,
            questionnaire TINYINT DEFAULT 0,
            journal_text TINYINT DEFAULT 0,
            shared_chat TINYINT DEFAULT 0,
            app_usage TINYINT DEFAULT 0,
            notifications TINYINT DEFAULT 0,
            health_data TINYINT DEFAULT 0
        )
        """
    )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS professional_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INT NOT NULL,
            subject VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            replied TINYINT DEFAULT 0
        )
        """
    )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS usage_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INT NOT NULL,
            active_seconds INT DEFAULT 0,
            idle_seconds INT DEFAULT 0,
            interactions INT DEFAULT 0,
            collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS health_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INT NOT NULL,
            heart_rate FLOAT,
            sleep_hours FLOAT,
            steps INT,
            logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INT NOT NULL,
            endpoint VARCHAR(1024) NOT NULL UNIQUE,
            p256dh VARCHAR(512) NOT NULL,
            auth VARCHAR(512) NOT NULL,
            remind_enabled TINYINT DEFAULT 0,
            remind_time VARCHAR(5) DEFAULT '20:00',
            last_sent_date VARCHAR(10),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    _ensure_assessment_columns(connection)
    _ensure_message_columns(connection)
    _ensure_usage_columns(connection)

    connection.commit()
    connection.close()


def _ensure_assessment_columns(connection):
    """Add new assessment columns if they are missing (safe migration)."""

    _ensure_column(
        connection, "assessments", "risk_breakdown", "TEXT"
    )


def _ensure_usage_columns(connection):
    """Add monitoring-session columns to usage_logs (safe migration)."""

    _ensure_column(
        connection, "usage_logs", "text_changes", "INT DEFAULT 0"
    )
    _ensure_column(
        connection, "usage_logs", "peak_words", "INT DEFAULT 0"
    )
    _ensure_column(
        connection, "usage_logs", "monitoring_risk", "FLOAT DEFAULT 0"
    )


def _ensure_message_columns(connection):
    """Add the professional column if it is missing (safe migration)."""

    _ensure_column(
        connection, "professional_messages", "professional", "VARCHAR(255)"
    )