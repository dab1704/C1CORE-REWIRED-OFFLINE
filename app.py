import hmac
import io
import math
import os
import uuid
from datetime import date, datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_file
from PIL import Image

import db
import demo_seed
import reader
import rules

load_dotenv()  # read keys from .env

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "uploads")
MAX_BYTES = 10 * 1024 * 1024  # 10 MB upload limit

# Files in ./static are served at the site root (e.g. /index.html)
app = Flask(__name__, static_folder="static", static_url_path="")


def error(msg, code=400):
    # Clear JSON error instead of a crash page
    return jsonify({"error": msg}), code


@app.get("/")
def home():
    # Show the website's main page
    return app.send_static_file("index.html")


@app.get("/api/health")
def health():
    # Simple check that the server is up
    return jsonify({"ok": True})


@app.get("/api/patients")
def patients():
    # List all patients
    return jsonify(db.list_patients())


# ---------- reading a report ----------

def save_original(data, ext):
    # Keep the file exactly as it arrived
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, uuid.uuid4().hex + ext)
    with open(path, "wb") as f:
        f.write(data)
    return path


def find_or_create_patient(conn, name, age, sex):
    # Same name + age + sex means the same patient (name case is ignored)
    name = name.strip().title()  # "DEEPA RAO" -> "Deepa Rao"
    row = conn.execute("SELECT id FROM patients WHERE name = ? COLLATE NOCASE"
                       " AND age IS ? AND sex IS ?", (name, age, sex)).fetchone()
    if row:
        return row["id"]
    cur = conn.execute("INSERT INTO patients (name, age, sex) VALUES (?, ?, ?)",
                       (name, age, sex))
    return cur.lastrowid


def summary(conn, report_id, flags=()):
    # The small answer the API returns for a report
    rep = conn.execute("SELECT patient_id, level FROM reports WHERE id = ?",
                       (report_id,)).fetchone()
    rows = conn.execute("SELECT name, value, range_low, range_high FROM test_results "
                        "WHERE report_id = ?", (report_id,))
    worst = rules.assess([dict(r) for r in rows])["worst"]
    return {"id": report_id, "level": rep["level"], "patient_id": rep["patient_id"],
            "worst": worst, "flags": list(flags)}


def process_report(image_bytes, source, message_id=None, caption="", ext=".png", filename=""):
    """Read one report image, store it, rate it, and return a summary."""
    with db.get_db() as conn:
        if message_id:  # same message twice? return the first answer
            old = conn.execute("SELECT id FROM reports WHERE source = ? AND message_id = ?",
                               (source, message_id)).fetchone()
            if old:
                return summary(conn, old["id"])

    path = save_original(image_bytes, ext)
    status, data = "pending", None
    try:
        mime = Image.open(io.BytesIO(image_bytes)).get_format_mimetype()
        data, dropped = reader.read_image(image_bytes, mime, filename)
        if dropped:  # some tests could not be read as numbers
            status = "needs_review"
    except Exception as e:
        print(f"Gemini failed: {type(e).__name__}: {e}")
        print("GEMINI_API_KEY loaded:", bool(os.getenv("GEMINI_API_KEY")))
        status = "needs_verification"  # Gemini failed or sent bad JSON

    data = data or {"tests": []}
    values = data["tests"]
    with db.get_db() as conn:
        patient_id = None
        if data.get("patient_name"):
            sex = str(data.get("sex") or "").upper()[:1] or None
            age = int(data["age"]) if str(data.get("age") or "").isdigit() else None
            patient_id = find_or_create_patient(
                conn, data["patient_name"].strip(), age, sex if sex in ("M", "F") else None)
        rdate = data.get("report_date") or date.today().isoformat()
        history = db.patient_history(conn, patient_id) if patient_id else []
        now = [dict(v, date=rdate) for v in values]
        res = rules.assess(values, caption, history=history + now)
        level = res["level"]
        if status == "needs_verification" and level == "routine":
            level = "watch"  # an unread report must never look routine

        cur = conn.execute(
            "INSERT INTO reports (patient_id, received_at, source, message_id, image_path,"
            " status, level, report_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (patient_id, datetime.now(timezone.utc).isoformat(), source, message_id,
             path, status, level, rdate))
        rid = cur.lastrowid
        for v in values:
            conn.execute(
                "INSERT INTO test_results (report_id, name, value, unit, range_low,"
                " range_high, level) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (rid, v["name"], v["value"], v.get("unit"), v["range_low"],
                 v["range_high"], rules.test_level(v)))
        if caption:
            conn.execute("INSERT INTO messages (report_id, text) VALUES (?, ?)", (rid, caption))
        out = summary(conn, rid, res["flags"])
        out["status"] = status
        return out


@app.post("/api/reports")
def upload_report():
    # Accept an image in form field "file"
    f = request.files.get("file")
    if not f:
        return error("Send a file in the form field 'file'.")
    data = f.read()
    if not data:
        return error("The file is empty.")
    if len(data) > MAX_BYTES:
        return error("File is too large (10 MB max).", 413)
    source = request.form.get("source", "web")
    message_id = request.form.get("message_id") or None
    caption = request.form.get("caption", "")
    try:
        Image.open(io.BytesIO(data)).verify()  # is it really an image?
        ext = "." + (Image.open(io.BytesIO(data)).format or "png").lower()
    except Exception:
        return error("That file is not a readable image.")
    try:
        return jsonify(process_report(data, source, message_id, caption, ext=ext,
                                      filename=f.filename))
    except Exception:
        return error("Could not process the report.", 500)


# ---------- inbox, confirm, patient history ----------

RANK = {"urgent": 0, "unread": 1, "watch": 2, "routine": 3}  # lower number shows first


def report_tests(conn, report_id):
    # All tests of one report as plain dicts
    rows = conn.execute("SELECT id, name, value, unit, range_low, range_high, level "
                        "FROM test_results WHERE report_id = ? ORDER BY id", (report_id,))
    return [dict(r) for r in rows]


def inbox_items():
    # Every report as a dict, with the "unread" rule applied
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT r.id, r.patient_id, p.name AS patient_name, r.level,"
            " r.status, r.source, r.received_at,"
            " (SELECT text FROM messages m WHERE m.report_id = r.id LIMIT 1) AS caption"
            " FROM reports r LEFT JOIN patients p ON p.id = r.patient_id").fetchall()
        items = [dict(r, worst=rules.assess(report_tests(conn, r["id"]))["worst"],
                      image_url=f"/api/reports/{r['id']}/image")
                 for r in rows]
    for i in items:
        if i["status"] == "needs_verification" and i["level"] != "urgent":
            i["level"] = "unread"  # a human must look; a keyword-urgent one stays urgent
    return items


def nabz_order(items):
    # Urgent, unread, watch, routine; newest first inside a level
    items = sorted(items, key=lambda i: i["received_at"] or "", reverse=True)
    return sorted(items, key=lambda i: RANK.get(i["level"], 4))  # stable sort


@app.get("/api/inbox")
def inbox():
    return jsonify(nabz_order(inbox_items()))


@app.get("/api/compare")
def compare():
    # Proof panel: arrival order vs Nabz order, and where the urgent ones land
    items = inbox_items()
    arrival = sorted(items, key=lambda i: (i["received_at"] or "", i["id"]))
    nabz = nabz_order(items)

    def rows(order):
        return [{"pos": n, "id": i["id"], "patient_name": i["patient_name"],
                 "level": i["level"]} for n, i in enumerate(order, 1)]

    def urgent_positions(order):
        return [n for n, i in enumerate(order, 1) if i["level"] == "urgent"]

    a, b = urgent_positions(arrival), urgent_positions(nabz)
    return jsonify({
        "total": len(items), "total_urgent": len(a),
        "arrival_order": rows(arrival), "nabz_order": rows(nabz),
        "urgent_in_first_10_arrival": sum(p <= 10 for p in a),
        "urgent_in_first_10_nabz": sum(p <= 10 for p in b),
        "last_urgent_pos_arrival": a[-1] if a else None,
        "last_urgent_pos_nabz": b[-1] if b else None})


@app.get("/api/reports/<int:rid>/image")
def report_image(rid):
    # The original uploaded image of one report
    with db.get_db() as conn:
        row = conn.execute("SELECT image_path FROM reports WHERE id = ?", (rid,)).fetchone()
    name = demo_seed.file_name(row["image_path"]) if row else ""  # file name only
    path = os.path.join(UPLOAD_DIR, name)
    if not name or not os.path.isfile(path):
        return error("Image not found.", 404)
    return send_file(os.path.abspath(path))


def valid_fixes(fixes, test_ids):
    # Each fix must be {"id": a test of this report, "value": a finite number}
    return all(isinstance(f, dict) and f.get("id") in test_ids
               and isinstance(f.get("value"), (int, float))
               and not isinstance(f["value"], bool) and math.isfinite(f["value"])
               for f in fixes)


@app.post("/api/reports/<int:rid>/confirm")
def confirm_report(rid):
    # A human confirms the reading. Optional body: {"tests": [{"id": 5, "value": 4.1}]}
    fixes = (request.get_json(silent=True) or {}).get("tests", [])
    if not isinstance(fixes, list):
        return error("'tests' must be a list.")
    with db.get_db() as conn:
        rep = conn.execute("SELECT patient_id FROM reports WHERE id = ?", (rid,)).fetchone()
        if not rep:
            return error("Report not found.", 404)
        if not valid_fixes(fixes, {t["id"] for t in report_tests(conn, rid)}):
            return error("Each correction needs a test 'id' from this report and a numeric 'value'.")
        for f in fixes:
            conn.execute("UPDATE test_results SET value = ? WHERE id = ?", (f["value"], f["id"]))
        flags = []
        if fixes:  # corrected values can change the level, so rate the report again
            tests = report_tests(conn, rid)
            for t in tests:
                conn.execute("UPDATE test_results SET level = ? WHERE id = ?",
                             (rules.test_level(t), t["id"]))
            msg = conn.execute("SELECT text FROM messages WHERE report_id = ?", (rid,)).fetchone()
            history = db.patient_history(conn, rep["patient_id"]) if rep["patient_id"] else None
            res = rules.assess(tests, msg["text"] if msg else "", history=history)
            flags = res["flags"]
            conn.execute("UPDATE reports SET level = ? WHERE id = ?", (res["level"], rid))
        conn.execute("UPDATE reports SET status = 'confirmed' WHERE id = ?", (rid,))
        out = summary(conn, rid, flags)
        out["status"] = "confirmed"
        return jsonify(out)


@app.get("/api/patients/<int:pid>")
def patient_detail(pid):
    # One patient with every report, a value-over-time trend, and rising tests
    with db.get_db() as conn:
        p = conn.execute("SELECT id, name, age, sex FROM patients WHERE id = ?",
                         (pid,)).fetchone()
        if not p:
            return error("Patient not found.", 404)
        reports = []
        for r in conn.execute("SELECT id, report_date, received_at, level, status FROM reports"
                              " WHERE patient_id = ? ORDER BY report_date, id", (pid,)).fetchall():
            reports.append(dict(r, tests=report_tests(conn, r["id"]),
                                image_url=f"/api/reports/{r['id']}/image"))
        history = db.patient_history(conn, pid)
    trend = {}
    for h in sorted(history, key=lambda h: h["date"]):
        trend.setdefault(h["name"], []).append({"date": h["date"], "value": h["value"]})
    return jsonify({"patient": dict(p), "reports": reports, "trend": trend,
                    "rising": rules.rising_tests(history)})


def clear_data():
    # Demo reset: clear all patients, reports and uploaded files, keep settings.
    with db.get_db() as conn:
        for table in ("alerts", "messages", "test_results", "reports", "patients"):
            conn.execute(f"DELETE FROM {table}")
    if os.path.isdir(UPLOAD_DIR):
        for name in os.listdir(UPLOAD_DIR):
            path = os.path.join(UPLOAD_DIR, name)
            if os.path.isfile(path):
                os.remove(path)


@app.post("/api/reset")
def reset():
    # Back to the demo: clear everything, then reload the seed (same loader as startup)
    token = os.getenv("ADMIN_TOKEN")  # if set, the caller must send it
    sent = request.headers.get("X-Admin-Token", "")
    if token and not hmac.compare_digest(sent.encode(), token.encode()):
        return error("Forbidden.", 403)
    clear_data()
    try:
        demo_seed.load_seed_if_empty(UPLOAD_DIR)
    except Exception:
        return error("Data cleared, but the demo seed could not be loaded.", 500)
    return jsonify({"ok": True})


db.init_db()  # create tables on startup
try:  # an empty database gets the demo reports, so the site is never blank
    demo_seed.load_seed_if_empty(UPLOAD_DIR)
except Exception as e:
    print("Demo seed not loaded:", e)

if __name__ == "__main__":
    # Local run only. On Render, gunicorn starts the app (no debug mode).
    app.run(debug=os.getenv("FLASK_DEBUG") == "1", port=int(os.getenv("PORT", 5000)))
