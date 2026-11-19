"""API tests. They use the fake reader and a throwaway database, so no Gemini calls."""
import csv
import os
import tempfile
import unittest

import app
import db
import reader

REPORTS = "test_data/reports/"


class ApiTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        db.DB_PATH = os.path.join(tmp, "test.db")  # fresh database for every test
        app.UPLOAD_DIR = os.path.join(tmp, "uploads")
        db.init_db()
        reader.FAKE = True
        self.client = app.app.test_client()

    def upload(self, name):
        with open(REPORTS + name, "rb") as f:
            return self.client.post("/api/reports", data={"file": (f, name)}).get_json()

    def test_health(self):
        self.assertEqual(self.client.get("/api/health").get_json(), {"ok": True})

    def test_inbox_orders_by_urgency(self):
        routine = self.upload("report_09_C.png")
        watch = self.upload("report_22_A.png")
        urgent = self.upload("report_10_A.png")
        inbox = self.client.get("/api/inbox").get_json()
        self.assertEqual([i["id"] for i in inbox], [urgent["id"], watch["id"], routine["id"]])
        self.assertEqual(inbox[0]["worst"]["name"], "Potassium")
        self.assertEqual(inbox[0]["patient_name"], "Ravi Shankar")

    def test_confirm_with_correction_rerates(self):
        rep = self.upload("report_10_A.png")
        self.assertEqual(rep["level"], "urgent")
        detail = self.client.get(f"/api/patients/{rep['patient_id']}").get_json()
        k = next(t for t in detail["reports"][0]["tests"] if t["name"] == "Potassium")
        res = self.client.post(f"/api/reports/{rep['id']}/confirm",
                               json={"tests": [{"id": k["id"], "value": 4.0}]}).get_json()
        self.assertEqual(res["status"], "confirmed")
        self.assertEqual(res["level"], "watch")  # urea and creatinine are still high
        self.assertEqual(self.client.get("/api/inbox").get_json()[0]["status"], "confirmed")

    def test_confirm_errors(self):
        rep = self.upload("report_10_A.png")
        url = f"/api/reports/{rep['id']}/confirm"
        self.assertEqual(self.client.post("/api/reports/999/confirm").status_code, 404)
        self.assertEqual(self.client.post(url, json={"tests": "x"}).status_code, 400)
        self.assertEqual(self.client.post(url, json={"tests": [{"id": 1, "value": "high"}]}).status_code, 400)
        self.assertEqual(self.client.post(url, json={"tests": [{"id": 99999, "value": 1}]}).status_code, 400)
        self.assertEqual(self.client.post(url).status_code, 200)  # plain confirm is fine

    def test_patient_history_shows_rising_trend(self):
        with open("test_data/ground_truth.csv", newline="", encoding="utf-8") as f:
            files = [r["file"] for r in csv.DictReader(f) if r["patient"] == "Kavita Reddy"]
        for name in files:
            pid = self.upload(name)["patient_id"]
        detail = self.client.get(f"/api/patients/{pid}").get_json()
        self.assertEqual(len(detail["reports"]), 3)
        self.assertEqual([p["value"] for p in detail["trend"]["Glucose (Fasting)"]], [140, 165, 190])
        self.assertIn("Glucose (Fasting)", detail["rising"])

    def upload_unreadable(self):
        # A file name the fake reader does not know acts like a failed Gemini read
        with open(REPORTS + "report_09_C.png", "rb") as f:
            return self.client.post("/api/reports", data={"file": (f, "nope.png")}).get_json()

    def test_unread_sits_right_after_urgent(self):
        routine = self.upload("report_09_C.png")
        watch = self.upload("report_22_A.png")
        unread = self.upload_unreadable()
        urgent = self.upload("report_10_A.png")
        inbox = self.client.get("/api/inbox").get_json()
        self.assertEqual([i["id"] for i in inbox],
                         [urgent["id"], unread["id"], watch["id"], routine["id"]])
        self.assertEqual(inbox[1]["level"], "unread")

    def test_reset_clears_data_keeps_settings(self):
        self.upload("report_10_A.png")  # creates a new patient and an uploaded file
        self.assertTrue(os.listdir(app.UPLOAD_DIR))
        self.assertEqual(self.client.post("/api/reset").get_json(), {"ok": True})
        self.assertEqual(self.client.get("/api/inbox").get_json(), [])
        self.assertEqual(os.listdir(app.UPLOAD_DIR), [])
        self.assertEqual(len(self.client.get("/api/patients").get_json()), len(db.PATIENTS))
        with db.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0],
                             len(db.SETTINGS))

    def test_unknown_patient(self):
        self.assertEqual(self.client.get("/api/patients/999").status_code, 404)


if __name__ == "__main__":
    unittest.main()
