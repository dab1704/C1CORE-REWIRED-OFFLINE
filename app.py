import io
import os
import uuid
from datetime import date, datetime, timezone

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from PIL import Image

import db
import reader
import rules

load_dotenv()  # read keys from .env

UPLOAD_DIR = "uploads"
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
    # Same name + age + sex means the same patient
    row = conn.execute("SELECT id FROM patients WHERE name = ? AND age IS ? AND sex IS ?",
                       (name, age, sex)).fetchone()
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


def process_report(image_bytes, source, message_id=None, caption="", ext=".png"):
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
        data, dropped = reader.read_image(image_bytes, mime)
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
        return jsonify(process_report(data, source, message_id, caption, ext=ext))
    except Exception:
        return error("Could not process the report.", 500)


db.init_db()  # create tables on startup

if __name__ == "__main__":
    app.run(debug=True, port=5000)
