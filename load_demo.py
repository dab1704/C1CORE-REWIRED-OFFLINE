"""Reset the demo data, then upload the 25 sample reports in order (01 to 25).
Uses the real database. Run it yourself: python load_demo.py"""
import glob
import os
import time
from collections import Counter

import app
import reader
from try_all import retry_on_overload

REPORTS = "test_data/reports"


def main():
    reader.read_image = retry_on_overload(reader.read_image)  # one retry on 503/504
    app.clear_data()
    files = sorted(glob.glob(os.path.join(REPORTS, "report_*.png")))  # numbered, so 01..25
    levels, statuses = Counter(), Counter()
    for i, path in enumerate(files):
        if i:
            time.sleep(3)  # pause between reports
        name = os.path.basename(path)
        with open(path, "rb") as f:
            out = app.process_report(f.read(), "demo", name, filename=name)
        levels[out["level"]] += 1
        statuses[out["status"]] += 1
        print(f"{name:<18} {out['level']:<8} {out['status']}", flush=True)

    c = app.app.test_client().get("/api/compare").get_json()
    print(f"\nLoaded {c['total']} reports. Levels: {dict(levels)}. Statuses: {dict(statuses)}")
    print(f"Urgent: {c['total_urgent']}. In the first 10: "
          f"{c['urgent_in_first_10_arrival']} by arrival, {c['urgent_in_first_10_nabz']} by Nabz")
    print(f"Last urgent report sits at position {c['last_urgent_pos_arrival']} by arrival, "
          f"{c['last_urgent_pos_nabz']} by Nabz")


if __name__ == "__main__":
    main()
