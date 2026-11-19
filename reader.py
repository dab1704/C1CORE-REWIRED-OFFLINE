"""Reads a lab report image with the Gemini vision API."""
import json
import os
import time

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
print(f"Using Gemini model: {MODEL}")

# Dev-only: READER_MODE=fake in .env reads test_data/fake_readings.json, no API call
FAKE = os.getenv("READER_MODE", "gemini").lower() == "fake"
FAKE_FILE = "test_data/fake_readings.json"
if FAKE:
    print("FAKE READER ON")

PROMPT = """You read a medical lab report image. Reply with JSON only, no prose:
{"patient_name": string|null, "age": integer|null, "sex": "M"|"F"|null,
 "report_date": "YYYY-MM-DD"|null,
 "tests": [{"name": string, "value": number, "unit": string|null,
            "range_low": number|null, "range_high": number|null}]}
Rules: copy test names exactly as printed. "value" is the patient's result.
Range "70 - 99" -> low 70, high 99. Range "<200" -> low null, high 200.
Range ">40" -> low 40, high null. Use null for anything you cannot read.
Never guess a digit."""


def num(x):
    # Number or None; anything else is an error
    if x is None:
        return None
    return float(x)


def clean(data):
    """Check Gemini's JSON. Returns (data, dropped) or raises ValueError."""
    if not isinstance(data, dict) or not isinstance(data.get("tests"), list):
        raise ValueError("no tests list")
    tests, dropped = [], 0
    for t in data["tests"]:
        try:
            tests.append({"name": str(t["name"]).strip(), "value": float(t["value"]),
                          "unit": t.get("unit"), "range_low": num(t.get("range_low")),
                          "range_high": num(t.get("range_high"))})
        except (KeyError, TypeError, ValueError):
            dropped += 1  # a test we could not read as a number
    if not tests:
        raise ValueError("no readable tests")
    data["tests"] = tests
    return data, dropped


def fake_read(filename):
    # Look up the upload's file name; an unknown name raises, like a failed read
    with open(FAKE_FILE, encoding="utf-8") as f:
        return clean(json.load(f)[os.path.basename(filename or "")])


def read_image(image_bytes, mime="image/png", filename=""):
    """Ask Gemini to read the image. Raises on any failure (caller handles)."""
    if FAKE:
        return fake_read(filename)
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"),
                          http_options=types.HttpOptions(timeout=30000))  # 30 s, in ms
    last = None
    for attempt in range(2):  # one retry for a temporary error
        try:
            resp = client.models.generate_content(
                model=MODEL,
                contents=[types.Part.from_bytes(data=image_bytes, mime_type=mime), PROMPT],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_level="LOW")))  # faster
            return clean(json.loads(resp.text))
        except Exception as e:
            last = e
            time.sleep(3)
    raise last
