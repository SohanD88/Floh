from fastapi import FastAPI, HTTPException
import requests
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from spellcheck import find_misspelled_word, check_languagetool_health
import os

def get_allowed_origins():
    origins = os.getenv(
        "ALLOWED_ORIGINS",
        "http://127.0.0.1:8000,http://localhost:8000"
    )
    return [
        origin.strip()
        for origin in origins.split(",")
        if origin.strip()
    ]



app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    allow_credentials=False,
)

class SpellcheckRequest(BaseModel):
    sentence: str
    cursor_position: int
    ignored_words: list[str] = Field(default_factory=list)

@app.get("/health")
def health_check():
    try:
        check_languagetool_health()
    except requests.RequestException:
        return {
            "status": "degraded",
            "languagetool": "unavailable",
        }

    return {
        "status": "ok",
        "languagetool": "ok",
    }

@app.post("/spellcheck")
def spellcheck(request: SpellcheckRequest):
    try:
        return find_misspelled_word(
            request.sentence,
            request.cursor_position,
            request.ignored_words,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="LanguageTool is unavailable")
