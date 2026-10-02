import json
import os
from datetime import datetime, timezone

from pypdf import PdfReader
from supabase import create_client

MAX_RESUME_CHARS = 20000

_db = None


def _get_db():
    # Created lazily so .env is already loaded by the time this runs
    global _db
    if _db is None:
        _db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"])
    return _db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_resume(file_path: str) -> str:
    """Extract text from a PDF resume."""
    reader = PdfReader(file_path)
    text = "\n".join((page.extract_text() or "") for page in reader.pages).strip()
    if not text:
        raise ValueError("No readable text found in the PDF")
    return text[:MAX_RESUME_CHARS]


def save_profile(user_id: str, profile_json: str) -> str:
    """Save or replace the user's entire profile."""
    try:
        data = json.loads(profile_json)
    except json.JSONDecodeError:
        return "Error: profile_json must be valid JSON."
    _get_db().table("profiles").upsert(
        {"user_id": user_id, "data": data, "updated_at": _now()}
    ).execute()
    return "Profile saved."


def get_profile(user_id: str) -> str:
    """Return the user's profile as a JSON string."""
    res = _get_db().table("profiles").select("data").eq("user_id", user_id).limit(1).execute()
    if not res.data:
        return json.dumps({"error": "No profile found."})
    return json.dumps(res.data[0]["data"])


def update_skills(user_id: str, skills_json: str) -> str:
    """Update only the skills part of the user's profile."""
    res = _get_db().table("profiles").select("data").eq("user_id", user_id).limit(1).execute()
    if not res.data:
        return "No profile found to update."
    profile = res.data[0]["data"]
    profile["skills"] = json.loads(skills_json)
    _get_db().table("profiles").upsert(
        {"user_id": user_id, "data": profile, "updated_at": _now()}
    ).execute()
    return "Skills updated."


def get_chat_history(user_id: str, limit: int = 50) -> list:
    """Return the most recent messages, oldest first."""
    res = (
        _get_db()
        .table("chat_messages")
        .select("role, content")
        .eq("user_id", user_id)
        .order("id", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(res.data or []))


def add_chat_message(user_id: str, role: str, content: str) -> None:
    _get_db().table("chat_messages").insert(
        {"user_id": user_id, "role": role, "content": content}
    ).execute()