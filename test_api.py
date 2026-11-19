"""API tests. They use the fake reader and a throwaway database, so no Gemini calls."""
import csv
import os
import tempfile
import unittest
import unittest.mock

import app
import db
import demo_seed
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

    def test_clear_data_clears_everything_keeps_settings(self):
        self.upload("report_10_A.png")  # creates a new patient and an uploaded file
        self.assertTrue(os.listdir(app.UPLOAD_DIR))
        app.clear_data()
        self.assertEqual(self.client.get("/api/inbox").get_json(), [])
        self.assertEqual(os.listdir(app.UPLOAD_DIR), [])
        self.assertEqual(len(self.client.get("/api/patients").get_json()), len(db.PATIENTS))
        with db.get_db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0],
                             len(db.SETTINGS))

    def test_compare_arrival_vs_nabz(self):
        empty = self.client.get("/api/compare").get_json()
        self.assertEqual((empty["total"], empty["last_urgent_pos_nabz"]), (0, None))
        # Seeded reports (no Gemini): arrival is routine, watch, urgent, unread
        rows = [("routine", "pending"), ("watch", "pending"), ("urgent", "pending"),
                ("watch", "needs_verification")]
        with db.get_db() as conn:
            for n, (level, status) in enumerate(rows, 1):
                conn.execute("INSERT INTO reports (patient_id, received_at, source, status,"
                             " level) VALUES (1, ?, 'test', ?, ?)", (f"2026-11-19T10:0{n}", status, level))
        c = self.client.get("/api/compare").get_json()
        self.assertEqual((c["total"], c["total_urgent"]), (4, 1))
        self.assertEqual([r["id"] for r in c["arrival_order"]], [1, 2, 3, 4])
        self.assertEqual([r["id"] for r in c["nabz_order"]], [3, 4, 2, 1])
        self.assertEqual(c["nabz_order"][1]["level"], "unread")
        self.assertEqual((c["last_urgent_pos_arrival"], c["last_urgent_pos_nabz"]), (3, 1))
        self.assertEqual((c["urgent_in_first_10_arrival"], c["urgent_in_first_10_nabz"]), (1, 1))

    def test_patient_name_is_title_case_and_matched_ignoring_case(self):
        with db.get_db() as conn:
            a = app.find_or_create_patient(conn, "DEEPA RAO", 38, "F")
            b = app.find_or_create_patient(conn, "deepa rao", 38, "F")  # same patient
            c = app.find_or_create_patient(conn, "Deepa Rao", 39, "F")  # other age
            seeded = app.find_or_create_patient(conn, "ASHA VERMA", 54, "F")  # seeded row
            name = conn.execute("SELECT name FROM patients WHERE id = ?", (a,)).fetchone()[0]
        self.assertEqual((a, name), (b, "Deepa Rao"))
        self.assertNotEqual(a, c)
        self.assertEqual(seeded, 1)  # matched the seeded "Asha Verma", no duplicate

    def test_reset_restores_the_25_demo_reports(self):
        self.upload("report_10_A.png")  # some other data that reset must replace
        self.assertEqual(self.client.post("/api/reset").get_json(), {"ok": True})
        inbox = self.client.get("/api/inbox").get_json()
        self.assertEqual(len(inbox), 25)
        self.assertEqual(len(os.listdir(app.UPLOAD_DIR)), 25)
        self.assertTrue(all(i["status"] == "pending" for i in inbox))
        with db.get_db() as conn:  # settings survive
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM settings").fetchone()[0],
                             len(db.SETTINGS))
        # a restored report still has its image
        res = self.client.get(inbox[0]["image_url"])
        self.assertEqual(res.status_code, 200)
        res.close()

    def test_reset_needs_admin_token_when_set(self):
        self.upload("report_10_A.png")
        with unittest.mock.patch.dict(os.environ, {"ADMIN_TOKEN": "s3cret"}):
            self.assertEqual(self.client.post("/api/reset").status_code, 403)
            bad = self.client.post("/api/reset", headers={"X-Admin-Token": "nope"})
            self.assertEqual(bad.status_code, 403)
            self.assertEqual(len(self.client.get("/api/inbox").get_json()), 1)  # untouched
            ok = self.client.post("/api/reset", headers={"X-Admin-Token": "s3cret"})
            self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(self.client.get("/api/inbox").get_json()), 25)

    def test_report_image_route(self):
        rep = self.upload("report_10_A.png")
        res = self.client.get(f"/api/reports/{rep['id']}/image")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, "image/png")
        with open(REPORTS + "report_10_A.png", "rb") as f:
            self.assertEqual(res.data, f.read())  # the original, byte for byte
        res.close()
        # image_url is on every inbox item and every patient-history report
        url = f"/api/reports/{rep['id']}/image"
        self.assertEqual(self.client.get("/api/inbox").get_json()[0]["image_url"], url)
        detail = self.client.get(f"/api/patients/{rep['patient_id']}").get_json()
        self.assertEqual(detail["reports"][0]["image_url"], url)

    def test_report_image_404s(self):
        self.assertEqual(self.client.get("/api/reports/999/image").status_code, 404)
        rep = self.upload("report_10_A.png")
        for name in os.listdir(app.UPLOAD_DIR):  # file gone, row still there
            os.remove(os.path.join(app.UPLOAD_DIR, name))
        self.assertEqual(self.client.get(f"/api/reports/{rep['id']}/image").status_code, 404)

    def test_demo_seed_round_trip(self):
        tmp = tempfile.mkdtemp()
        seed, images = os.path.join(tmp, "seed.json"), os.path.join(tmp, "images")
        self.upload("report_10_A.png")
        self.upload("report_09_C.png")
        before = self.client.get("/api/inbox").get_json()
        counts = demo_seed.export_seed(app.UPLOAD_DIR, seed, images)
        self.assertEqual((counts["reports"], len(os.listdir(images))), (2, 2))
        app.clear_data()  # empty database and no uploaded files
        self.assertTrue(demo_seed.load_seed_if_empty(app.UPLOAD_DIR, seed, images))
        self.assertEqual(self.client.get("/api/inbox").get_json(), before)
        self.assertEqual(len(os.listdir(app.UPLOAD_DIR)), 2)
        self.assertFalse(demo_seed.load_seed_if_empty(app.UPLOAD_DIR, seed, images))  # not empty now

    def test_unknown_patient(self):
        self.assertEqual(self.client.get("/api/patients/999").status_code, 404)


if __name__ == "__main__":
    unittest.main()
