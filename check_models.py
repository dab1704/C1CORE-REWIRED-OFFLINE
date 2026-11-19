"""Times reader.read_image on one report with several Gemini models (no retry)."""
import sys
import time

import reader

MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.6-flash",
          "gemini-3.7-flash", "gemini-3.8-flash"]
IMAGE = "test_data/reports/report_10_A.png"


def no_retry(_seconds):
    # reader sleeps only before a retry; re-raise the error instead
    raise sys.exception()


def main():
    reader.time.sleep = no_retry  # 30 s timeout already comes from reader.py
    image = open(IMAGE, "rb").read()

    for model in MODELS:
        reader.MODEL = model  # read_image uses this at call time
        start = time.time()
        try:
            data, _ = reader.read_image(image)
            potassium = next((t["value"] for t in data["tests"]
                              if "potassium" in t["name"].lower()), None)
            result = f"{data.get('patient_name')} | potassium {potassium}"
        except Exception as e:
            result = f"{type(e).__name__}: {str(e)[:80]}"
        print(f"{model:<24} {time.time() - start:5.1f}s  {result}", flush=True)


if __name__ == "__main__":
    main()
