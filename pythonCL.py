"""
coach_lytics_api.py
===================
Coach-Lytics — Python Backend (Flask + Google Gemini API)

Setup:
    pip install flask flask-cors google-generativeai python-dotenv

Run:
    python coach_lytics_api.py

Environment Variables (.env):
    GEMINI_API_KEY=your_key_here

Endpoints:
    POST /api/generate  — accepts { "advice": "..." }, returns structured plan
    GET  /api/health    — health check
"""

import os
import json
import re
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv

# ══════════════════════════════════════════
# CONFIG
# ══════════════════════════════════════════



load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s — %(message)s"
)
log = logging.getLogger("CoachLytics")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL   = "gemini-1.5-flash"   # Fast + capable; swap to gemini-1.5-pro for depth

MAX_ADVICE_LEN = 1000

app = Flask(__name__)
CORS(app)   # Allow requests from your HTML frontend

@app.route("/")
def home():
    return "Coachlytics API is running 🚀"

# ══════════════════════════════════════════
# GEMINI CLIENT CLASS
# ══════════════════════════════════════════
class CoachLyticsAI:
    """
    Wraps the Google Gemini API for Coach-Lytics.
    Converts raw coach advice → structured JSON training plan.
    """

    SYSTEM_PROMPT = """
You are CoachLytics AI — an elite sports performance analyst and personal coach assistant.
Your job is to decode a coach's advice and turn it into a structured, actionable training plan.

You MUST respond ONLY with valid JSON — no markdown, no code blocks, no explanation.

JSON Schema:
{
  "focus_area": "Short label (3–5 words) for the primary training focus",
  "training_plan": ["Drill or exercise name", ...],  // 3–5 items
  "daily_goals": ["Specific quantified goal", ...],  // 3–5 items with numbers
  "action_steps": [
    { "title": "Step name", "description": "Clear 1-sentence instruction" },
    ...
  ],  // 4–6 steps in order
  "motivation": "One powerful motivational sentence tailored to the focus area",
  "coach_notes": "2–3 sentences of expert coaching commentary on the advice",
  "intensity_score": 75  // 0–100 integer: how intense is this session?
}

Rules:
- training_plan items are drill NAMES only, no descriptions
- daily_goals MUST include specific numbers (reps, sets, distance, time)
- action_steps go in logical workout order (warm up → drills → cool down)
- intensity_score: 20–40 = light, 41–65 = moderate, 66–85 = hard, 86–100 = elite
- Be sport-agnostic: work for any sport unless the advice specifies one
- ONLY output JSON. Any other text will break the application.
"""

    def __init__(self):
        if not GEMINI_API_KEY:
            raise EnvironmentError(
                "GEMINI_API_KEY not set. Add it to your .env file.\n"
                "Get a free key at: https://aistudio.google.com/app/apikey"
            )
        genai.configure(api_key=GEMINI_API_KEY)
        self.model = genai.GenerativeModel(
            model_name=GEMINI_MODEL,
            system_instruction=self.SYSTEM_PROMPT,
            generation_config=genai.GenerationConfig(
                temperature=0.7,
                top_p=0.9,
                max_output_tokens=1024,
            )
        )
        log.info(f"CoachLytics AI initialized — model: {GEMINI_MODEL}")

    def generate_plan(self, advice: str) -> dict:
        """
        Send coach advice to Gemini, parse and return structured plan.

        Args:
            advice: Raw coaching advice text from the user.

        Returns:
            dict: Structured training plan matching JSON schema above.

        Raises:
            ValueError: If input is invalid.
            RuntimeError: If Gemini returns unparseable output.
        """
        advice = advice.strip()

        if not advice:
            raise ValueError("Advice cannot be empty.")
        if len(advice) > MAX_ADVICE_LEN:
            raise ValueError(f"Advice too long (max {MAX_ADVICE_LEN} chars).")

        prompt = f"""Coach's advice to decode:

"{advice}"

Generate the JSON training plan now."""

        log.info(f"Sending prompt to Gemini ({len(advice)} chars)...")

        try:
            response = self.model.generate_content(prompt)
            raw = response.text.strip()
        except Exception as e:
            log.error(f"Gemini API error: {e}")
            raise RuntimeError(f"Gemini API error: {str(e)}")

        return self._parse_response(raw)

    def _parse_response(self, raw: str) -> dict:
        """
        Clean and parse Gemini's JSON response.
        Handles edge cases where model wraps JSON in markdown.
        """
        # Strip markdown code fences if present
        cleaned = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()

        # Find JSON object boundaries
        start = cleaned.find("{")
        end   = cleaned.rfind("}") + 1

        if start == -1 or end == 0:
            log.error(f"No JSON found in response: {cleaned[:200]}")
            raise RuntimeError("Gemini returned non-JSON response.")

        json_str = cleaned[start:end]

        try:
            plan = json.loads(json_str)
        except json.JSONDecodeError as e:
            log.error(f"JSON parse error: {e}\nRaw: {json_str[:300]}")
            raise RuntimeError(f"Failed to parse Gemini response: {str(e)}")

        # Validate required keys
        required = ["focus_area", "training_plan", "daily_goals", "action_steps"]
        missing = [k for k in required if k not in plan]
        if missing:
            raise RuntimeError(f"Response missing keys: {missing}")

        # Clamp intensity_score
        if "intensity_score" in plan:
            plan["intensity_score"] = max(0, min(100, int(plan["intensity_score"])))

        log.info(f"Plan generated: focus='{plan.get('focus_area')}', intensity={plan.get('intensity_score')}")
        return plan


# ══════════════════════════════════════════
# FLASK ROUTES
# ══════════════════════════════════════════

# Initialize AI once at startup (not on every request)
try:
    ai = CoachLyticsAI()
except EnvironmentError as e:
    log.warning(f"AI not initialized: {e}")
    ai = None


@app.route("/api/health", methods=["GET"])
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "model":  GEMINI_MODEL,
        "ai_ready": ai is not None
    })


@app.route("/api/generate", methods=["POST"])
def generate():
    """
    Generate a training plan from coach advice.

    Request body:
        { "advice": "your coach's advice here" }

    Response:
        200 — { focus_area, training_plan, daily_goals, action_steps, ... }
        400 — { error: "validation message" }
        500 — { error: "server error message" }
    """
    if ai is None:
        return jsonify({
            "error": "AI not initialized. Check GEMINI_API_KEY in your .env file."
        }), 500

    data = request.get_json(silent=True)

    if not data or "advice" not in data:
        return jsonify({"error": "Request body must include 'advice' field."}), 400

    advice = str(data["advice"]).strip()

    if len(advice) < 5:
        return jsonify({"error": "Advice is too short. Please provide more detail."}), 400

    try:
        plan = ai.generate_plan(advice)
        return jsonify(plan), 200

    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    except RuntimeError as e:
        log.error(f"Generation failed: {e}")
        return jsonify({"error": "Plan generation failed. Please try again."}), 500

    except Exception as e:
        log.exception("Unexpected error in /api/generate")
        return jsonify({"error": "An unexpected error occurred."}), 500


# ══════════════════════════════════════════
# STANDALONE USAGE (CLI testing)
# ══════════════════════════════════════════
def demo_cli():
    """
    Test the AI directly from command line without running Flask.
    Usage: python coach_lytics_api.py --demo
    """
    print("\n🔬 CoachLytics AI — CLI Demo\n" + "─" * 40)
    sample_advice = input("Enter coach advice (or press Enter for default): ").strip()

    if not sample_advice:
        sample_advice = (
            "You need to work on your first step quickness. "
            "Your lateral movement is too slow — try shuffling more "
            "and crossing over less. Also increase your sprint endurance."
        )
        print(f"\nUsing: {sample_advice}\n")

    try:
        client = CoachLyticsAI()
        print("⚡ Sending to Gemini...\n")
        result = client.generate_plan(sample_advice)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(f"❌ Error: {e}")


# ══════════════════════════════════════════
# ENTRY POINT
# ══════════════════════════════════════════
if __name__ == "__main__":
    import sys

    if "--demo" in sys.argv:
        demo_cli()
    else:
        print("""
╔═══════════════════════════════════════╗
║  🏆  CoachLytics API — Starting Up    ║
║  http://localhost:5000                ║
║  POST /api/generate  (main endpoint)  ║
║  GET  /api/health    (check status)   ║
╚═══════════════════════════════════════╝
        """)
        app.run(host="0.0.0.0", port=5001, debug=True)


