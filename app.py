import os
import secrets

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

import json
import math
import time
import threading
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    jsonify,
    abort,
    Response
)
from database import get_db_connection, init_db
from werkzeug.security import generate_password_hash, check_password_hash
from nlp import analyze_text, analyze_text_with_llm

try:
    from pywebpush import webpush
    from py_vapid import Vapid01
    PUSH_AVAILABLE = True
except Exception:
    webpush = None
    Vapid01 = None
    PUSH_AVAILABLE = False

app = Flask(__name__)

# Never cache static assets so UI updates are visible immediately
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0


@app.after_request
def no_cache(response):
    response.headers["Cache-Control"] = \
        "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


@app.route("/favicon.ico")
def favicon():
    return ("", 204)


@app.route("/sw.js")
def service_worker():
    """Serve the service worker from the site root so it covers all pages."""

    sw_path = os.path.join(BASE_DIR, "static", "service-worker.js")
    if not os.path.exists(sw_path):
        abort(404)
    with open(sw_path, "rb") as f:
        body = f.read()
    return Response(body, mimetype="application/javascript")

# Secret key for login sessions (prefer environment variable)
app.secret_key = os.environ.get("MINDWATCH_SECRET_KEY", "mindwatch-secret-key")

# Secure session cookie settings
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=False,  # set True when served over HTTPS
    TEMPLATES_AUTO_RELOAD=True,
)

# Create required database tables if they do not exist yet
try:
    init_db()
except Exception as e:
    print("Database initialization warning:", e)


# =========================
# WEB PUSH (VAPID) KEYS
# =========================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VAPID_FILE = os.path.join(BASE_DIR, "vapid.json")


def load_or_create_vapid():
    """Load the saved VAPID key pair, or generate and persist a new one."""

    if os.path.exists(VAPID_FILE):
        try:
            with open(VAPID_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass

    keys = {}
    if Vapid01 is not None:
        try:
            instance = Vapid01()
            instance.generate_keys()
            keys = {
                "public_key": instance.public_pem().decode("utf-8"),
                "private_key": instance.private_pem().decode("utf-8")
            }
        except Exception:
            keys = {}

    if keys:
        try:
            with open(VAPID_FILE, "w", encoding="utf-8") as f:
                json.dump(keys, f)
        except Exception:
            pass

    return keys


VAPID = load_or_create_vapid()
VAPID_PUBLIC_KEY = VAPID.get("public_key", "")

REMINDER_MESSAGE = (
    "Ready for your daily check-in? A quick 2-minute assessment "
    "helps you understand how you're feeling today."
)


# =========================
# CSRF PROTECTION
# =========================
# State-changing requests must include a matching X-CSRFToken header.
# Login / signup / logout are exempt (they are the entry/exit points).
CSRF_EXEMPT = {"/login", "/signup", "/logout"}


def get_csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_hex(16)
    return session["csrf_token"]


@app.before_request
def csrf_protect():
    if request.method not in ("POST", "PUT", "DELETE", "PATCH"):
        return
    if request.path in CSRF_EXEMPT:
        return
    expected = session.get("csrf_token")
    if not expected or request.headers.get("X-CSRFToken") != expected:
        abort(403)


# =========================
# HOME
# =========================
@app.route("/")
def home():
    return redirect(url_for("login"))


# =========================
# SIGNUP
# =========================
@app.route("/signup", methods=["GET", "POST"])
def signup():

    if request.method == "POST":

        name = request.form["name"]
        email = request.form["email"]
        password = request.form["password"]

        hashed_password = generate_password_hash(password)

        try:
            connection = get_db_connection()
            cursor = connection.cursor()

            sql = """
            INSERT INTO users (name, email, password)
            VALUES (%s, %s, %s)
            """

            values = (name, email, hashed_password)

            cursor.execute(sql, values)
            connection.commit()

            cursor.close()
            connection.close()

            return jsonify({
                "success": True,
                "message": "Account created successfully. You can now login."
            })

        except Exception as e:
            return jsonify({
                "success": False,
                "message": f"Signup failed: {e}"
            })

    return render_template("signup.html")


# =========================
# LOGIN
# =========================
@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "POST":

        email = request.form["email"]
        password = request.form["password"]

        try:
            connection = get_db_connection()
            cursor = connection.cursor(dictionary=True)

            sql = """
            SELECT * FROM users
            WHERE email = %s
            """

            cursor.execute(sql, (email,))

            user = cursor.fetchone()

            cursor.close()
            connection.close()

            if user is None:
                return "Invalid email or password."

            if check_password_hash(user["password"], password):

                # Save logged-in user's information
                session["user_id"] = user["id"]
                session["user_name"] = user["name"]
                session["user_email"] = user["email"]

                # Generate CSRF token for this session
                get_csrf_token()

                # Open dashboard
                return redirect(url_for("dashboard"))

            else:
                return "Invalid email or password."

        except Exception as e:
            return f"Login failed: {e}"

    return render_template("login.html")


# =========================
# WEB PUSH ROUTES
# =========================
@app.route("/push/subscribe", methods=["POST"])
def push_subscribe():
    """Save this browser's push subscription for the logged-in user."""

    if "user_id" not in session:
        return jsonify({"success": False, "message": "Please login first."}), 401
    if not PUSH_AVAILABLE or not VAPID_PUBLIC_KEY:
        return jsonify({"success": False,
                        "message": "Web push is not available here."}), 400

    try:
        data = request.get_json(silent=True) or {}
        endpoint = (data.get("endpoint") or "").strip()
        p256dh = (data.get("p256dh") or "").strip()
        auth = (data.get("auth") or "").strip()

        if not endpoint or not p256dh or not auth:
            return jsonify({"success": False, "message": "Missing push data."}), 400

        user_id = session["user_id"]
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            "SELECT id FROM push_subscriptions WHERE endpoint = %s",
            (endpoint,)
        )
        existing = cursor.fetchone()

        if existing:
            cursor.execute(
                "UPDATE push_subscriptions SET p256dh = %s, auth = %s "
                "WHERE id = %s",
                (p256dh, auth, existing[0])
            )
            sub_id = existing[0]
        else:
            cursor.execute(
                "INSERT INTO push_subscriptions "
                "(user_id, endpoint, p256dh, auth) VALUES (%s, %s, %s, %s)",
                (user_id, endpoint, p256dh, auth)
            )
            sub_id = cursor.lastrowid

        connection.commit()
        cursor.close()
        connection.close()

        return jsonify({"success": True, "subscription_id": sub_id})

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/push/schedule", methods=["POST"])
def push_schedule():
    """Update the daily reminder schedule for the user's push subscriptions."""

    if "user_id" not in session:
        return jsonify({"success": False, "message": "Please login first."}), 401

    try:
        data = request.get_json(silent=True) or {}
        enabled = 1 if data.get("enabled") else 0
        remind_time = str(data.get("time") or "20:00")[:5]

        user_id = session["user_id"]
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            "UPDATE push_subscriptions SET remind_enabled = %s, "
            "remind_time = %s WHERE user_id = %s",
            (enabled, remind_time, user_id)
        )
        connection.commit()
        cursor.close()
        connection.close()

        return jsonify({"success": True})

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/push/unsubscribe", methods=["POST"])
def push_unsubscribe():
    """Remove a push subscription (e.g. when the user disables reminders)."""

    if "user_id" not in session:
        return jsonify({"success": False, "message": "Please login first."}), 401

    try:
        data = request.get_json(silent=True) or {}
        endpoint = (data.get("endpoint") or "").strip()

        user_id = session["user_id"]
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            "DELETE FROM push_subscriptions "
            "WHERE user_id = %s AND endpoint = %s",
            (user_id, endpoint)
        )
        connection.commit()
        cursor.close()
        connection.close()

        return jsonify({"success": True})

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


def push_reminder_scheduler():
    """Background loop: send the web push when a user's reminder time hits."""

    while True:
        try:
            connection = get_db_connection()
            cursor = connection.cursor(dictionary=True)

            now = datetime.now()
            hhmm = now.strftime("%H:%M")
            today = now.strftime("%Y-%m-%d")

            cursor.execute(
                "SELECT id, endpoint, p256dh, auth, remind_time, "
                "last_sent_date FROM push_subscriptions "
                "WHERE remind_enabled = 1"
            )
            rows = cursor.fetchall()

            for row in rows:
                if row["remind_time"] != hhmm:
                    continue
                if row["last_sent_date"] == today:
                    continue
                if not PUSH_AVAILABLE:
                    continue

                payload = json.dumps({
                    "title": "MindWatch daily check-in",
                    "body": REMINDER_MESSAGE
                })

                try:
                    webpush(
                        subscription_info={
                            "endpoint": row["endpoint"],
                            "keys": {
                                "p256dh": row["p256dh"],
                                "auth": row["auth"]
                            }
                        },
                        data=payload,
                        vapid_private_key=VAPID.get("private_key", ""),
                        vapid_claims={"sub": "mailto:mindwatch@localhost"}
                    )
                    cursor.execute(
                        "UPDATE push_subscriptions SET last_sent_date = %s "
                        "WHERE id = %s",
                        (today, row["id"])
                    )
                except Exception as e:
                    # 404/410 means the subscription is dead - drop it.
                    status = getattr(e, "status_code", None)
                    if status in (404, 410):
                        cursor.execute(
                            "DELETE FROM push_subscriptions WHERE id = %s",
                            (row["id"],)
                        )

            connection.commit()
            cursor.close()
            connection.close()

        except Exception:
            # Never let scheduler hiccups kill the loop.
            pass

        time.sleep(20)


# =========================
# DASHBOARD
# =========================
@app.route("/dashboard")
def dashboard():

    if "user_id" not in session:
        return redirect(url_for("login"))

    user_id = session["user_id"]

    try:
        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        sql = """
        SELECT *
        FROM assessments
        WHERE user_id = %s
        ORDER BY created_at DESC
        LIMIT 1
        """

        cursor.execute(sql, (user_id,))

        assessment = cursor.fetchone()

        cursor.close()
        connection.close()

        return render_template(
            "index.html",
            user_name=session["user_name"],
            assessment=assessment,
            csrf_token=get_csrf_token(),
            vapid_public_key=VAPID_PUBLIC_KEY
        )

    except Exception as e:
        return f"Dashboard failed: {e}"

    # =========================
# ASSESSMENT HISTORY
# =========================
@app.route("/assessment-history")
def assessment_history():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:

        user_id = session["user_id"]

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        sql = """
SELECT
    id,
    journal_text,
    heart_rate,
    sleep_hours,
    physical_activity,
    screen_time,
    social_interactions,
    stress_level,
    wellness_score,
    risk_level,
    risk_breakdown,
    DATE_FORMAT(created_at, '%d %b %Y, %I:%M:%S %p') AS created_at
FROM assessments
WHERE user_id = %s
ORDER BY assessments.created_at DESC
"""

        cursor.execute(sql, (user_id,))

        assessments = cursor.fetchall()

        import json
        for a in assessments:
            raw = a.get("risk_breakdown")
            if isinstance(raw, str) and raw.strip():
                try:
                    a["risk_breakdown"] = json.loads(raw)
                except Exception:
                    a["risk_breakdown"] = {}
            else:
                a["risk_breakdown"] = {}

        cursor.close()
        connection.close()

        return jsonify({
            "success": True,
            "assessments": assessments
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


# =========================
# NEARBY CLINICS (OpenStreetMap / Overpass)
# =========================

def haversine(lat1, lng1, lat2, lng2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) *
         math.cos(math.radians(lat2)) *
         math.sin(dlng / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))


def _query_overpass(lat, lng, radius):
    query = (
        "[out:json][timeout:25];("
        f'nwr["healthcare"~"psychiatr|psycholog|psychotherap|'
        f'psychoanalys|counsel|mental|therapist",i]'
        f'(around:{radius},{lat},{lng});'
        f'nwr["healthcare:speciality"~"psychiatr|psycholog|'
        f'psychotherap|psychoanalys|counsel|mental|therapy",i]'
        f'(around:{radius},{lat},{lng});'
        f'nwr["amenity"~"psychiatr|psycholog|psychotherap|'
        f'counsel|mental",i](around:{radius},{lat},{lng});'
        f'nwr["office"~"psycholog|psychotherap|counsel",i]'
        f'(around:{radius},{lat},{lng});'
        f'nwr["social_facility"~"mental",i]'
        f'(around:{radius},{lat},{lng});'
        f'nwr["amenity"~"clinic|hospital|doctors"]'
        f'(around:{radius},{lat},{lng});'
        ");out center 200;"
    )
    endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter",
    ]
    data = query.encode("utf-8")
    for url in endpoints:
        try:
            req = urllib.request.Request(
                url,
                data=data,
                headers={
                    "User-Agent":
                        "MindWatchDemo/1.0 (educational prototype)"
                }
            )
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            continue
    return None


def _is_mental_health(tags, name):
    keys = [
        "healthcare",
        "healthcare:speciality",
        "healthcare:specialist",
        "amenity",
        "office",
        "social_facility",
    ]
    hay = " ".join(str(tags.get(k, "")).lower() for k in keys)
    if any(w in hay for w in
           ["psychiatr", "psycholog", "psychotherap",
            "psychoanalys", "counsel", "mental"]):
        return True
    return any(w in (name or "").lower() for w in
               ["psychiatr", "psycholog", "psychotherap",
                "counsel", "mental"])


def _parse_clinics(overpass, lat, lng):
    clinics = []
    for el in overpass.get("elements", []):

        tags = el.get("tags", {})

        if el["type"] == "node":
            plat, plng = el.get("lat"), el.get("lon")
        else:
            center = el.get("center")
            if not center:
                continue
            plat, plng = center.get("lat"), center.get("lon")

        if plat is None or plng is None:
            continue

        name = tags.get("name")
        if not name:
            name = ""

        # Keep only mental-health professionals.
        if not _is_mental_health(tags, name):
            continue

        ctype = "Mental Health Professional"
        speciality = (
            tags.get("healthcare:speciality") or
            tags.get("healthcare:specialist") or ""
        ).replace("_", " ").strip().title()
        if speciality:
            ctype = speciality + " (" + ctype + ")"

        addr_parts = [
            tags.get("addr:housenumber"),
            tags.get("addr:street"),
            tags.get("addr:city"),
            tags.get("addr:suburb"),
        ]
        address = ", ".join([a for a in addr_parts if a]) \
            or "Address not listed"

        email = (tags.get("contact:email") or
                 tags.get("email") or "").strip()
        phone = (tags.get("contact:phone") or
                 tags.get("phone") or "").strip()
        website = (tags.get("contact:website") or
                   tags.get("website") or "").strip()

        clinics.append({
            "name": name,
            "type": ctype,
            "specialty": (speciality or "Mental Health"),
            "lat": plat,
            "lng": plng,
            "distance_km": round(
                haversine(lat, lng, plat, plng), 1),
            "address": address,
            "email": email,
            "phone": phone,
            "website": website,
        })

    clinics.sort(key=lambda c: c["distance_km"])

    seen = set()
    uniq = []
    for c in clinics:
        key = (round(c["lat"], 5), round(c["lng"], 5), c["name"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)

    return uniq[:12]


def _geocode(query):
    try:
        url = ("https://nominatim.openstreetmap.org/search"
               "?format=json&limit=1&q=" + urllib.parse.quote(query))
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent":
                    "MindWatchDemo/1.0 (educational prototype)"
            }
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data and len(data) > 0:
            return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        return None
    return None


CLINIC_CACHE = {}
CLINIC_CACHE_TTL = 3600


_FALLBACK_DIRECTORY = [
    {
        "city": "Bengaluru",
        "lat": 12.9716, "lng": 77.5946,
        "clinics": [
            {"name": "National Institute of Mental Health and "
                     "Neurosciences (NIMHANS)",
             "type": "Government Mental Health Institute",
             "specialty": "Psychiatry & Neurosciences",
             "address": "Hosur Road, Bengaluru, Karnataka",
             "lat": 12.9346, "lng": 77.5968,
             "email": "", "phone": "", "website": "https://www.nimhans.ac.in"},
            {"name": "Victoria Hospital - Bangalore Medical College "
                     "and Research Institute",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry",
             "address": "K.R. Road, Bengaluru, Karnataka",
             "lat": 12.9616, "lng": 77.5750,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Mysuru",
        "lat": 12.2958, "lng": 76.6394,
        "clinics": [
            {"name": "K.R. Hospital - Mysore Medical College",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry",
             "address": "Krishnarajendra Road, Mysuru",
             "lat": 12.3166, "lng": 76.6490,
             "email": "", "phone": "", "website": ""},
            {"name": "JSS Hospital - JSS Medical College",
             "type": "Medical College Hospital - Psychiatry Dept",
             "specialty": "Psychiatry, Psychology & Counseling",
             "address": "M.G. Road, Shivarampet, Mysuru",
             "lat": 12.3183, "lng": 76.6558,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Delhi NCR",
        "lat": 28.6139, "lng": 77.2090,
        "clinics": [
            {"name": "Institute of Human Behaviour and Allied "
                     "Sciences (IHBAS)",
             "type": "Government Mental Health Institute",
             "specialty": "Psychiatry & Behavioural Sciences",
             "address": "Dilshad Garden, Delhi",
             "lat": 28.7072, "lng": 77.2929,
             "email": "", "phone": "", "website": ""},
            {"name": "All India Institute of Medical Sciences (AIIMS) - "
                     "Department of Psychiatry",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry & Mental Health",
             "address": "Ansari Nagar, New Delhi",
             "lat": 28.5665, "lng": 77.2100,
             "email": "", "phone": "", "website": "https://www.aiims.edu"},
        ],
    },
    {
        "city": "Mumbai",
        "lat": 19.0760, "lng": 72.8777,
        "clinics": [
            {"name": "K.E.M. Hospital - Seth G.S. Medical College",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry",
             "address": "Parel, Mumbai, Maharashtra",
             "lat": 19.0025, "lng": 72.8396,
             "email": "", "phone": "", "website": ""},
            {"name": "Sion Hospital - L.T.M. Medical College",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry & Psychology Services",
             "address": "Sion, Mumbai, Maharashtra",
             "lat": 19.0438, "lng": 72.8620,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Hyderabad",
        "lat": 17.3850, "lng": 78.4867,
        "clinics": [
            {"name": "Institute of Mental Health, Erragadda",
             "type": "Government Mental Health Institute",
             "specialty": "Psychiatry & Counseling",
             "address": "Sanathnagar, Hyderabad, Telangana",
             "lat": 17.4464, "lng": 78.4503,
             "email": "", "phone": "", "website": ""},
            {"name": "Nizam's Institute of Medical Sciences (NIMS) - "
                     "Psychiatry",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry & Mental Health",
             "address": "Panjagutta, Hyderabad, Telangana",
             "lat": 17.3664, "lng": 78.4622,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Chennai",
        "lat": 13.0827, "lng": 80.2707,
        "clinics": [
            {"name": "Institute of Mental Health, Kilpauk",
             "type": "Government Mental Health Institute",
             "specialty": "Psychiatry, Psychology & Counseling",
             "address": "Kilpauk, Chennai, Tamil Nadu",
             "lat": 13.0863, "lng": 80.2410,
             "email": "", "phone": "", "website": ""},
            {"name": "Rajiv Gandhi Government General Hospital - "
                     "Madras Medical College",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry",
             "address": "Park Town, Chennai, Tamil Nadu",
             "lat": 13.0794, "lng": 80.2780,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Kolkata",
        "lat": 22.5726, "lng": 88.3639,
        "clinics": [
            {"name": "Institute of Psychiatry - IPGME&R, SSKM Hospital",
             "type": "Government Mental Health Institute",
             "specialty": "Psychiatry & Psychological Medicine",
             "address": "Bhowanipore, Kolkata, West Bengal",
             "lat": 22.5375, "lng": 88.3389,
             "email": "", "phone": "", "website": ""},
            {"name": "Calcutta Medical College - Psychiatry Dept",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry",
             "address": "College Street, Kolkata, West Bengal",
             "lat": 22.5353, "lng": 88.3400,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Pune",
        "lat": 18.5204, "lng": 73.8567,
        "clinics": [
            {"name": "Maharashtra Institute of Mental Health (MIMH)",
             "type": "Government Mental Health Institute",
             "specialty": "Psychiatry & Counseling",
             "address": "Yerwada, Pune, Maharashtra",
             "lat": 18.5450, "lng": 73.8780,
             "email": "", "phone": "", "website": ""},
            {"name": "Sassoon General Hospital - B.J. Medical College",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry",
             "address": "J.M. Road, Pune, Maharashtra",
             "lat": 18.5200, "lng": 73.8810,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Ahmedabad",
        "lat": 23.0225, "lng": 72.5714,
        "clinics": [
            {"name": "Civil Hospital Ahmedabad - B.J. Medical College",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry & Psychology Services",
             "address": "Asarwa, Ahmedabad, Gujarat",
             "lat": 23.0450, "lng": 72.5830,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "Jaipur",
        "lat": 26.9124, "lng": 75.7873,
        "clinics": [
            {"name": "Sawai Man Singh (SMS) Hospital - Psychiatry Dept",
             "type": "Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry & Mental Health",
             "address": "Jawahar Lal Nehru Marg, Jaipur, Rajasthan",
             "lat": 26.8930, "lng": 75.8150,
             "email": "", "phone": "", "website": ""},
        ],
    },
    {
        "city": "National referral centers",
        "lat": 23.0000, "lng": 79.0000,
        "clinics": [
            {"name": "National Institute of Mental Health and "
                     "Neurosciences (NIMHANS)",
             "type": "National Mental Health Institute",
             "specialty": "Psychiatry & Neurosciences",
             "address": "Hosur Road, Bengaluru, Karnataka",
             "lat": 12.9346, "lng": 77.5968,
             "email": "", "phone": "", "website": "https://www.nimhans.ac.in"},
            {"name": "All India Institute of Medical Sciences (AIIMS) - "
                     "Department of Psychiatry",
             "type": "National Government Hospital - Psychiatry Dept",
             "specialty": "Psychiatry & Mental Health",
             "address": "Ansari Nagar, New Delhi",
             "lat": 28.5665, "lng": 77.2100,
             "email": "", "phone": "", "website": "https://www.aiims.edu"},
            {"name": "Christian Medical College (CMC Vellore) - "
                     "Department of Psychiatry",
             "type": "Medical College - Psychiatry Dept",
             "specialty": "Psychiatry, Psychology & Counseling",
             "address": "Vellore, Tamil Nadu",
             "lat": 12.9254, "lng": 79.1223,
             "email": "", "phone": "", "website": "https://www.cmch-vellore.edu"},
        ],
    },
]


def _fallback_clinics(lat, lng):
    best = None
    best_d = None
    for entry in _FALLBACK_DIRECTORY:
        d = haversine(lat, lng, entry["lat"], entry["lng"])
        if best_d is None or d < best_d:
            best_d = d
            best = entry
    if best is None:
        return [], None
    clinics = []
    for c in best["clinics"]:
        item = dict(c)
        item["distance_km"] = round(
            haversine(lat, lng, c["lat"], c["lng"]), 1)
        clinics.append(item)
    return clinics, best["city"]


def _clinic_cache_key(lat, lng):
    return (round(lat, 2), round(lng, 2))


@app.route("/api/nearby-clinics")
def nearby_clinics():

    try:

        lat = request.args.get("lat", type=float)
        lng = request.args.get("lng", type=float)
        q = request.args.get("q", type=str)

        if lat is None or lng is None:
            if q:
                geo = _geocode(q)
                if geo:
                    lat, lng = geo
                else:
                    return jsonify({
                        "success": False,
                        "message": "Could not find that location."
                    }), 404
            else:
                return jsonify({
                    "success": False,
                    "message": "Missing coordinates or location."
                }), 400

        # Serve cached results instantly when available
        # (speeds up re-visits and pin dragging).
        cache_key = _clinic_cache_key(lat, lng)
        cached = CLINIC_CACHE.get(cache_key)
        if cached and (time.time() - cached["ts"]) < CLINIC_CACHE_TTL:
            return jsonify({
                "success": True,
                "clinics": cached["clinics"],
                "count": len(cached["clinics"]),
                "lat": lat,
                "lng": lng,
                "source": cached.get("source", "OPENSTREETMAP"),
                "live_unavailable": cached.get(
                    "live_unavailable", False),
                "fallback_city": cached.get("fallback_city"),
                "cached": True
            })

        # Fast 10 km search first; fall back to 100 km only if
        # nothing is found nearby.
        overpass = None
        clinics = []
        for radius in (10000, 100000):
            overpass = _query_overpass(lat, lng, radius)
            if overpass is None:
                break
            clinics = _parse_clinics(overpass, lat, lng)
            if clinics:
                break

        source = "OPENSTREETMAP"
        fallback_city = None

        # If the live lookup failed or found nothing, always show a
        # built-in directory of known mental-health institutions so
        # the feature never returns empty.
        if not clinics:
            clinics, fallback_city = _fallback_clinics(lat, lng)
            if clinics:
                source = "DIRECTORY"

        live_unavailable = overpass is None

        CLINIC_CACHE[cache_key] = {
            "clinics": clinics,
            "source": source,
            "live_unavailable": live_unavailable,
            "fallback_city": fallback_city,
            "ts": time.time()
        }

        return jsonify({
            "success": True,
            "clinics": clinics,
            "count": len(clinics),
            "lat": lat,
            "lng": lng,
            "source": source,
            "live_unavailable": live_unavailable,
            "fallback_city": fallback_city
        })

    except urllib.error.URLError:
        return jsonify({
            "success": False,
            "message": "Could not reach the map service. "
                       "Check your internet connection."
        }), 502
    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

@app.route("/analytics-data")
def analytics_data():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:

        user_id = session["user_id"]

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        sql = """
        SELECT
            created_at,
            wellness_score,
            risk_level
        FROM assessments
        WHERE user_id = %s
        ORDER BY created_at ASC
        """

        cursor.execute(sql, (user_id,))

        assessments = cursor.fetchall()

        cursor.close()
        connection.close()

        return jsonify({
            "success": True,
            "assessments": assessments
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500
    
@app.route("/logout", methods=["GET", "POST"])
def logout():

    session.clear()

    return redirect(url_for("login"))

# =========================
# SAVE ASSESSMENT
# =========================
@app.route("/save-assessment", methods=["POST"])
def save_assessment():

    # Make sure user is logged in
    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:
        data = request.get_json()

        user_id = session["user_id"]

        journal_text = data.get("journal_text", "")
        heart_rate = data.get("heart_rate")
        sleep_hours = data.get("sleep_hours")
        physical_activity = data.get("physical_activity")
        screen_time = data.get("screen_time")
        social_interactions = data.get("social_interactions")
        stress_level = data.get("stress_level")
        wellness_score = data.get("wellness_score")
        risk_level = data.get("risk_level")
        risk_breakdown = data.get("risk_breakdown")

        import json
        if isinstance(risk_breakdown, dict):
            risk_breakdown = json.dumps(risk_breakdown)

        connection = get_db_connection()
        cursor = connection.cursor()

        sql = """
        INSERT INTO assessments
        (
            user_id,
            journal_text,
            heart_rate,
            sleep_hours,
            physical_activity,
            screen_time,
            social_interactions,
            stress_level,
            wellness_score,
            risk_level,
            risk_breakdown
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """

        values = (
            user_id,
            journal_text,
            heart_rate,
            sleep_hours,
            physical_activity,
            screen_time,
            social_interactions,
            stress_level,
            wellness_score,
            risk_level,
            risk_breakdown
        )

        cursor.execute(sql, values)
        connection.commit()

        cursor.close()
        connection.close()

        return jsonify({
            "success": True,
            "message": "Assessment saved successfully!"
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

# =========================
# SAVE MONITORING SESSION
# =========================
@app.route("/monitoring-session", methods=["POST"])
def save_monitoring_session():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:

        data = request.get_json() or {}

        user_id = session["user_id"]

        sql = """
        INSERT INTO usage_logs
        (
            user_id,
            active_seconds,
            idle_seconds,
            interactions,
            text_changes,
            peak_words,
            monitoring_risk
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        """

        values = (
            user_id,
            int(data.get("active_seconds") or 0),
            int(data.get("idle_seconds") or 0),
            int(data.get("interactions") or 0),
            int(data.get("text_changes") or 0),
            int(data.get("peak_words") or 0),
            float(data.get("monitoring_risk") or 0)
        )

        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(sql, values)
        connection.commit()
        cursor.close()
        connection.close()

        return jsonify({
            "success": True,
            "message": "Monitoring session saved."
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


# =========================
# MONITORING SESSION HISTORY
# =========================
@app.route("/monitoring-history")
def monitoring_history():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:

        user_id = session["user_id"]

        connection = get_db_connection()
        cursor = connection.cursor(dictionary=True)

        sql = """
SELECT
    id,
    active_seconds,
    idle_seconds,
    interactions,
    text_changes,
    peak_words,
    monitoring_risk,
    DATE_FORMAT(collected_at, '%d %b %Y, %I:%M:%S %p') AS collected_at
FROM usage_logs
WHERE user_id = %s
ORDER BY collected_at DESC
"""

        cursor.execute(sql, (user_id,))
        sessions = cursor.fetchall()
        cursor.close()
        connection.close()

        return jsonify({
            "success": True,
            "sessions": sessions
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

# =========================
# SAVE CONSENT PREFERENCES
# =========================
@app.route("/save-consent", methods=["POST"])
def save_consent():

    print("SAVE CONSENT ROUTE CALLED")

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:

        data = request.get_json()

        print("Received data:", data)

        user_id = session["user_id"]

        questionnaire = 1 if data.get("questionnaire") else 0
        journal_text = 1 if data.get("journal_text") else 0
        shared_chat = 1 if data.get("shared_chat") else 0
        app_usage = 1 if data.get("app_usage") else 0
        notifications = 1 if data.get("notifications") else 0
        health_data = 1 if data.get("health_data") else 0

        connection = get_db_connection()
        cursor = connection.cursor()

        # Check existing consent
        cursor.execute(
            "SELECT id FROM consent WHERE user_id = %s",
            (user_id,)
        )

        existing = cursor.fetchone()

        print("Existing consent:", existing)

        if existing:

            sql = """
            UPDATE consent
            SET
                questionnaire = %s,
                journal_text = %s,
                shared_chat = %s,
                app_usage = %s,
                notifications = %s,
                health_data = %s
            WHERE user_id = %s
            """

            values = (
                questionnaire,
                journal_text,
                shared_chat,
                app_usage,
                notifications,
                health_data,
                user_id
            )

        else:

            sql = """
            INSERT INTO consent
            (
                user_id,
                questionnaire,
                journal_text,
                shared_chat,
                app_usage,
                notifications,
                health_data
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """

            values = (
                user_id,
                questionnaire,
                journal_text,
                shared_chat,
                app_usage,
                notifications,
                health_data
            )

        cursor.execute(sql, values)

        connection.commit()

        cursor.close()
        connection.close()

        print("CONSENT SAVED SUCCESSFULLY")

        return jsonify({
            "success": True,
            "message": "Privacy preferences saved successfully!"
        })

    except Exception as e:

        print("CONSENT DATABASE ERROR:", e)

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500

    # =========================
# GET CONSENT (used to enforce collection)
# =========================
@app.route("/get-consent", methods=["GET"])
def get_consent():

    if "user_id" not in session:
        return jsonify({"success": False, "message": "Login required."}), 401

    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "SELECT questionnaire, journal_text, shared_chat, "
            "app_usage, notifications, health_data "
            "FROM consent WHERE user_id = %s",
            (session["user_id"],)
        )
        row = cursor.fetchone()
        cursor.close()
        connection.close()

        if not row:
            return jsonify({
                "success": True,
                "consent": {
                    "questionnaire": False,
                    "journal_text": False,
                    "shared_chat": False,
                    "app_usage": False,
                    "notifications": False,
                    "health_data": False,
                }
            })

        return jsonify({
            "success": True,
            "consent": {
                "questionnaire": bool(row[0]),
                "journal_text": bool(row[1]),
                "shared_chat": bool(row[2]),
                "app_usage": bool(row[3]),
                "notifications": bool(row[4]),
                "health_data": bool(row[5]),
            }
        })

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# =========================
# LOG REAL APP-USAGE TELEMETRY (consent gated)
# =========================
@app.route("/log-usage", methods=["POST"])
def log_usage():

    if "user_id" not in session:
        return jsonify({"success": False, "message": "Login required."}), 401

    try:
        data = request.get_json() or {}

        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "SELECT app_usage FROM consent WHERE user_id = %s",
            (session["user_id"],)
        )
        row = cursor.fetchone()

        if not row or not row[0]:
            cursor.close()
            connection.close()
            return jsonify({
                "success": False,
                "message": "App-usage collection not consented."
            }), 403

        active = int(data.get("active_seconds") or 0)
        idle = int(data.get("idle_seconds") or 0)
        interactions = int(data.get("interactions") or 0)

        cursor.execute(
            "INSERT INTO usage_logs "
            "(user_id, active_seconds, idle_seconds, interactions) "
            "VALUES (%s, %s, %s, %s)",
            (session["user_id"], active, idle, interactions)
        )
        connection.commit()
        cursor.close()
        connection.close()

        return jsonify({"success": True,
                        "message": "Usage session recorded."})

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


# =========================
# SAVE REAL HEALTH DATA (manual sync, consent gated)
# =========================
@app.route("/save-health", methods=["POST"])
def save_health():

    if "user_id" not in session:
        return jsonify({"success": False, "message": "Login required."}), 401

    try:
        data = request.get_json() or {}

        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "SELECT health_data FROM consent WHERE user_id = %s",
            (session["user_id"],)
        )
        row = cursor.fetchone()

        if not row or not row[0]:
            cursor.close()
            connection.close()
            return jsonify({
                "success": False,
                "message": "Health-data collection not consented."
            }), 403

        hr = data.get("heart_rate")
        sleep = data.get("sleep_hours")
        steps = data.get("steps")

        cursor.execute(
            "INSERT INTO health_logs "
            "(user_id, heart_rate, sleep_hours, steps) "
            "VALUES (%s, %s, %s, %s)",
            (session["user_id"],
             float(hr) if hr not in (None, "") else None,
             float(sleep) if sleep not in (None, "") else None,
             int(steps) if steps not in (None, "") else None)
        )
        connection.commit()
        cursor.close()
        connection.close()

        return jsonify({"success": True,
                        "message": "Real health data saved."})

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route("/get-health", methods=["GET"])
def get_health():

    if "user_id" not in session:
        return jsonify({"success": False, "message": "Login required."}), 401

    try:
        connection = get_db_connection()
        cursor = connection.cursor()
        cursor.execute(
            "SELECT heart_rate, sleep_hours, steps, logged_at "
            "FROM health_logs WHERE user_id = %s "
            "ORDER BY logged_at DESC LIMIT 1",
            (session["user_id"],)
        )
        row = cursor.fetchone()
        cursor.close()
        connection.close()

        if not row:
            return jsonify({"success": True, "health": None})

        return jsonify({
            "success": True,
            "health": {
                "heart_rate": row[0],
                "sleep_hours": row[1],
                "steps": row[2],
                "logged_at": str(row[3]) if row[3] else None
            }
        })

    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


    # =========================
# NLP TEXT ANALYSIS
# =========================
@app.route("/analyze-nlp", methods=["POST"])
def analyze_nlp():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:

        data = request.get_json()

        text = data.get("text", "")

        result = analyze_text_with_llm(text)

        return jsonify({
            "success": True,
            "sentiment": result["sentiment"],
            "text_risk": result["text_risk"],
            "word_count": result["word_count"]
        })

    except Exception as e:

        return jsonify({
            "success": False,
            "message": str(e)
        }), 500
    
# =========================
# TEST DATABASE
# =========================
@app.route("/test-db")
def test_database():

    try:
        connection = get_db_connection()

        if connection.is_connected():
            connection.close()
            return "MySQL Database Connected Successfully!"

    except Exception as e:
        return f"Database connection failed: {e}"


# =========================
# SEND PROFESSIONAL MESSAGE (one-to-one)
# =========================
@app.route("/send-professional-message", methods=["POST"])
def send_professional_message():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:
        data = request.get_json(silent=True) or request.form

        subject = (data.get("subject") or "").strip()
        message = (data.get("message") or "").strip()
        professional = (data.get("professional") or "").strip()

        if not subject or not message:
            return jsonify({
                "success": False,
                "message": "Subject and message are required."
            }), 400

        connection = get_db_connection()
        cursor = connection.cursor()

        sql = """
        INSERT INTO professional_messages
        (user_id, subject, message, professional)
        VALUES (%s, %s, %s, %s)
        """

        cursor.execute(
            sql,
            (session["user_id"], subject, message, professional)
        )

        connection.commit()
        cursor.close()
        connection.close()

        return jsonify({
            "success": True,
            "message": "Your message was sent to the professional."
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@app.route("/api/my-professional-messages")
def my_professional_messages():

    if "user_id" not in session:
        return jsonify({
            "success": False,
            "message": "Please login first."
        }), 401

    try:
        connection = get_db_connection()
        cursor = connection.cursor()

        cursor.execute(
            """
            SELECT id, professional, subject, message,
                   created_at, replied
            FROM professional_messages
            WHERE user_id = %s
            ORDER BY created_at DESC
            """,
            (session["user_id"],)
        )

        rows = cursor.fetchall()
        cursor.close()
        connection.close()

        messages = []
        for r in rows:
            messages.append({
                "id": r[0],
                "professional": r[1] or "A professional",
                "subject": r[2],
                "message": r[3],
                "created_at": r[4].strftime("%Y-%m-%d %H:%M")
                               if r[4] else "",
                "replied": bool(r[5])
            })

        return jsonify({
            "success": True,
            "messages": messages
        })

    except Exception as e:
        return jsonify({
            "success": False,
            "message": str(e)
        }), 500


@app.route("/ai-support", methods=["POST"])
def ai_support():

    try:

        data = request.get_json()

        message = (
            data.get("message", "")
            .strip()
        )


        if not message:

            return jsonify({
                "success": False,
                "message": "Please enter a message."
            }), 400


        # ------------------------------------------------
        # BASIC WELLNESS SUPPORT ENGINE
        # ------------------------------------------------

        text = message.lower()


        if any(word in text for word in [
            "stress",
            "stressed",
            "pressure",
            "overwhelmed"
        ]):

            response = (
                "It sounds like you may be experiencing "
                "some stress or pressure. Try taking a "
                "short break, slow breathing for a few "
                "minutes, and breaking large tasks into "
                "smaller steps. If these feelings persist "
                "or interfere with daily life, consider "
                "speaking with a qualified professional."
            )


        elif any(word in text for word in [
            "sleep",
            "sleeping",
            "insomnia",
            "tired"
        ]):

            response = (
                "A consistent sleep routine can support "
                "overall wellbeing. Try keeping a regular "
                "sleep schedule, reducing screen use before "
                "bed, and creating a calm sleeping environment. "
                "If sleep problems continue, consider discussing "
                "them with a healthcare professional."
            )


        elif any(word in text for word in [
            "sad",
            "sadness",
            "lonely",
            "loneliness"
        ]):

            response = (
                "I'm sorry that you're feeling this way. "
                "Consider talking with someone you trust, "
                "spending some time doing an activity you enjoy, "
                "or writing down what you're experiencing. "
                "If these feelings continue or become difficult "
                "to manage, professional support may help."
            )


        elif any(word in text for word in [
            "concentration",
            "focus",
            "focused"
        ]):

            response = (
                "Difficulty concentrating can happen when "
                "we are tired, stressed, or overloaded. "
                "Try working in short focused periods, "
                "taking regular breaks, and reducing "
                "distractions."
            )


        elif any(word in text for word in [
            "hello",
            "hi",
            "hey"
        ]):

            response = (
                "Hello! I'm MindWatch AI Support. "
                "You can tell me about your current "
                "wellness concerns, such as stress, "
                "sleep, concentration, or daily routines."
            )


        else:

            response = (
                "Thank you for sharing that. Take a "
                "moment to notice how you are feeling "
                "right now. You could try a short break, "
                "slow breathing, journaling, or talking "
                "with someone you trust. If your concerns "
                "persist or affect your daily life, consider "
                "speaking with a qualified professional."
            )


        return jsonify({
            "success": True,
            "response": response
        })


    except Exception as error:

        print(
            "AI support error:",
            error
        )


        return jsonify({
            "success": False,
            "message":
                "AI support could not process your message."
        }), 500
    
# =========================
# START FLASK
# =========================
if __name__ == "__main__":
    # Background task: send web-push reminders at each user's chosen time
    threading.Thread(target=push_reminder_scheduler, daemon=True).start()

    # host="0.0.0.0" lets other devices on the same Wi-Fi open the app
    # via http://<this-PC-LAN-IP>:5000.
    # NOTE: debug=True must NOT be used with 0.0.0.0 on untrusted
    # networks (Werkzeug debugger can allow remote code execution).
    app.run(host="0.0.0.0", port=5000, debug=False)