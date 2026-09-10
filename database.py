import os

import mysql.connector


def get_db_connection():
    connection = mysql.connector.connect(
        host=os.environ.get("MINDWATCH_DB_HOST", "localhost"),
        user=os.environ.get("MINDWATCH_DB_USER", "root"),
        password=os.environ.get("MINDWATCH_DB_PASSWORD", ""),
        database=os.environ.get("MINDWATCH_DB_NAME", "mindwatch_db")
    )

    return connection


def init_db():
    """Create the required tables if they do not already exist."""

    connection = get_db_connection()
    cursor = connection.cursor()

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS assessments (
            id INT AUTO_INCREMENT PRIMARY KEY,
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

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS consent (
            id INT AUTO_INCREMENT PRIMARY KEY,
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

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS professional_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            subject VARCHAR(255) NOT NULL,
            message TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            replied TINYINT DEFAULT 0
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS usage_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            active_seconds INT DEFAULT 0,
            idle_seconds INT DEFAULT 0,
            interactions INT DEFAULT 0,
            collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS health_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            heart_rate FLOAT,
            sleep_hours FLOAT,
            steps INT,
            logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
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

    _ensure_assessment_columns(cursor)
    _ensure_message_columns(cursor)
    _ensure_usage_columns(cursor)

    connection.commit()
    cursor.close()
    connection.close()


def _ensure_assessment_columns(cursor):
    """Add new assessment columns if they are missing (safe migration)."""

    try:
        cursor.execute(
            """
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'assessments'
            """
        )
        existing = {row[0] for row in cursor.fetchall()}

        if "risk_breakdown" not in existing:
            cursor.execute(
                "ALTER TABLE assessments ADD COLUMN risk_breakdown TEXT"
            )
    except Exception:
        # Migration is best-effort; do not break app startup.
        pass


def _ensure_usage_columns(cursor):
    """Add monitoring-session columns to usage_logs (safe migration)."""

    try:
        cursor.execute(
            """
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'usage_logs'
            """
        )
        existing = {row[0] for row in cursor.fetchall()}

        if "text_changes" not in existing:
            cursor.execute(
                "ALTER TABLE usage_logs "
                "ADD COLUMN text_changes INT DEFAULT 0"
            )
        if "peak_words" not in existing:
            cursor.execute(
                "ALTER TABLE usage_logs "
                "ADD COLUMN peak_words INT DEFAULT 0"
            )
        if "monitoring_risk" not in existing:
            cursor.execute(
                "ALTER TABLE usage_logs "
                "ADD COLUMN monitoring_risk FLOAT DEFAULT 0"
            )
    except Exception:
        # Migration is best-effort; do not break app startup.
        pass


def _ensure_message_columns(cursor):
    """Add the professional column if it is missing (safe migration)."""

    try:
        cursor.execute(
            """
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'professional_messages'
            """
        )
        existing = {row[0] for row in cursor.fetchall()}

        if "professional" not in existing:
            cursor.execute(
                "ALTER TABLE professional_messages "
                "ADD COLUMN professional VARCHAR(255)"
            )
    except Exception:
        # Migration is best-effort; do not break app startup.
        pass