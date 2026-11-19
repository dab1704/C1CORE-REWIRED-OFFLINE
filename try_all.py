"""Send every sample report through process_report and score the result.
Uses a throwaway database and upload folder. Ground truth is read only here."""
import csv
import os
import tempfile

import app
import db
from test_rules import parse_values

REPORTS = "test_data/reports"
TRUTH = "test_data/ground_truth.csv"


def main():
    # Throwaway database and uploads, so nabz.db stays clean
    tmp = tempfile.mkdtemp()
    db.DB_PATH = os.path.join(tmp, "try_all.db")
    app.UPLOAD_DIR = os.path.join(tmp, "uploads")
    db.init_db()

    rows = list(csv.DictReader(open(TRUTH, newline="", encoding="utf-8")))
    score = {"patient": [0, 0], "value": [0, 0], "tier": [0, 0]}
    for r in rows:
        with open(os.path.join(REPORTS, r["file"]), "rb") as f:
            out = app.process_report(f.read(), "try_all", r["file"])
        with db.get_db() as conn:
            name = conn.execute(
                "SELECT p.name FROM reports r LEFT JOIN patients p ON p.id = r.patient_id "
                "WHERE r.id = ?", (out["id"],)).fetchone()["name"]
            got = {t["name"].lower(): t["value"] for t in conn.execute(
                "SELECT name, value FROM test_results WHERE report_id = ?", (out["id"],))}

        # patient name
        ok_name = (name or "").lower() == r["patient"].lower()
        score["patient"][0] += ok_name
        score["patient"][1] += 1
        # each test value
        wrong = []
        for t in parse_values(r["all_values_and_printed_range"]):
            score["value"][1] += 1
            if got.get(t["name"].lower()) == t["value"]:
                score["value"][0] += 1
            else:
                wrong.append(f"{t['name']} want {t['value']} got {got.get(t['name'].lower())}")
        # tier (TREND = watch + rising)
        want = r["expected_tier"].lower()
        have = "trend" if (out["level"] == "watch" and "rising" in out["flags"]) else out["level"]
        score["tier"][1] += 1
        score["tier"][0] += have == want

        notes = ([] if ok_name else [f"name got {name!r}"]) + wrong
        print(f"{r['file']:<18} tier want {want:<7} got {have:<7} status {out['status']:<18}"
              + ("  | " + "; ".join(notes) if notes else ""))

    print()
    for k, (ok, n) in score.items():
        print(f"{k:<8} {ok}/{n}  {100 * ok / n:.0f}%")


if __name__ == "__main__":
    main()
