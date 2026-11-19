"""Save the demo data to demo_seed.json (images to demo_uploads/) and load it back.
Export:  python demo_seed.py     Load: automatic at app startup if there are no reports."""
import json
import os
import shutil

import db

SEED_FILE = "demo_seed.json"
IMAGES_DIR = "demo_uploads"
TABLES = ["patients", "reports", "test_results", "messages", "alerts"]


def file_name(path):
    # "uploads\\abc.png" or "uploads/abc.png" -> "abc.png"
    return os.path.basename((path or "").replace("\\", "/"))


def export_seed(upload_dir, seed_file=SEED_FILE, images_dir=IMAGES_DIR):
    # Write every row of the data tables to JSON and copy the report images
    seed = {}
    with db.get_db() as conn:
        for table in TABLES:
            seed[table] = [dict(r) for r in conn.execute(f"SELECT * FROM {table} ORDER BY id")]
    os.makedirs(images_dir, exist_ok=True)
    for r in seed["reports"]:
        r["image_path"] = file_name(r["image_path"])  # keep only the file name
        src = os.path.join(upload_dir, r["image_path"])
        if r["image_path"] and os.path.isfile(src):
            shutil.copy2(src, images_dir)
    with open(seed_file, "w", encoding="utf-8") as f:
        json.dump(seed, f, indent=1)
    return {table: len(rows) for table, rows in seed.items()}


def load_seed_if_empty(upload_dir, seed_file=SEED_FILE, images_dir=IMAGES_DIR):
    # Fill an empty database from the seed file. Returns True if it loaded.
    if not os.path.isfile(seed_file):
        return False
    with db.get_db() as conn:
        if conn.execute("SELECT COUNT(*) FROM reports").fetchone()[0]:
            return False
        with open(seed_file, encoding="utf-8") as f:
            seed = json.load(f)
        for table in TABLES:
            for row in seed.get(table, []):
                if table == "reports" and row["image_path"]:
                    row["image_path"] = os.path.join(upload_dir, row["image_path"])
                names = ", ".join(row)
                marks = ", ".join("?" * len(row))
                conn.execute(f"INSERT OR REPLACE INTO {table} ({names}) VALUES ({marks})",
                             list(row.values()))
    os.makedirs(upload_dir, exist_ok=True)
    if os.path.isdir(images_dir):
        for name in os.listdir(images_dir):
            shutil.copy2(os.path.join(images_dir, name), upload_dir)
    return True


if __name__ == "__main__":
    print("Exported:", export_seed(os.getenv("UPLOAD_DIR", "uploads")))
