import os
import sys
import threading

from dotenv import load_dotenv


# Make sure the project root is importable when this module is
# loaded by the WSGI server (PythonAnywhere / gunicorn).
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

load_dotenv(os.path.join(BASE_DIR, ".env"))

from app import app as application  # noqa: E402


# The push-reminder scheduler only starts under `python app.py`.
# Start it once here too so reminders keep working on the server.
_scheduler_started = False


def _start_scheduler():

    global _scheduler_started

    if _scheduler_started:
        return

    _scheduler_started = True

    try:
        from app import push_reminder_scheduler
        thread = threading.Thread(
            target=push_reminder_scheduler,
            daemon=True
        )
        thread.start()
    except Exception as error:
        print("Web-push scheduler could not start:", error)