import logging
import os
import tempfile
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from supabase import create_client

from backend.agent_app.agent import ask_agent
from backend.mcp_server.tools.profile import get_chat_history, read_resume
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

load_dotenv()
logger = logging.getLogger("zero2offer")

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])

ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
]
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Credentials(BaseModel):
    email: str
    password: str


class ChatRequest(BaseModel):
    message: str


bearer_scheme = HTTPBearer()


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> str:
    """Verify the Supabase access token and return the real user id."""
    try:
        res = await run_in_threadpool(supabase.auth.get_user, creds.credentials)
        return res.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


@app.post("/auth/register")
async def register(req: Credentials):
    try:
        res = await run_in_threadpool(
            supabase.auth.sign_up, {"email": req.email, "password": req.password}
        )
    except Exception as e:
        logger.warning("Register failed: %s", e)
        raise HTTPException(status_code=400, detail="Could not register with these details")
    # If email confirmation is enabled in Supabase, session is None until they confirm
    return {
        "status": "registered",
        "user_id": res.user.id if res.user else None,
        "access_token": res.session.access_token if res.session else None,
    }


@app.post("/auth/login")
async def login(req: Credentials):
    try:
        res = await run_in_threadpool(
            supabase.auth.sign_in_with_password,
            {"email": req.email, "password": req.password},
        )
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {
        "status": "logged_in",
        "user_id": res.user.id,
        "access_token": res.session.access_token,
    }


@app.post("/api/onboard")
async def onboard(
    target_role: str = Form(...),
    extra_details: Optional[str] = Form(None),
    job_url: Optional[str] = Form(None),
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user),
):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF resume")
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 5 MB)")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        resume_text = await run_in_threadpool(read_resume, tmp_path)

        prompt = (
            f"Analyze my resume for the role of {target_role}.\n"
            f"Resume content: {resume_text}"
        )
        if extra_details:
            prompt += f"\nAdditional Context: {extra_details}"
        if job_url:
            prompt += f"\nReference Job URL: {job_url}"
        prompt += "\n\nPlease provide a breakdown of my Strengths, Gaps/Weaknesses, and a Roadmap to success."

        analysis = await ask_agent(user_id, prompt)
        return {"status": "success", "analysis": analysis}
    except Exception:
        logger.exception("Onboarding failed")
        raise HTTPException(status_code=500, detail="Could not analyse the resume. Please try again.")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@app.post("/api/chat")
async def chat(req: ChatRequest, user_id: str = Depends(get_current_user)):
    try:
        response = await ask_agent(user_id, req.message)
        return {"response": response}
    except Exception:
        logger.exception("Chat failed")
        raise HTTPException(status_code=500, detail="Something went wrong. Please try again.")


@app.get("/api/history")
async def history(user_id: str = Depends(get_current_user)):
    return {"history": get_chat_history(user_id)}