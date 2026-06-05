from fastapi import FastAPI, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
import requests
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi import _rate_limit_exceeded_handler
from pydantic import BaseModel, Field
from spellcheck import find_misspelled_word, check_languagetool_health
import os
from typing import Annotated

MAX_REQ_SIZE = 100_000

class SizeLimitedRoute(APIRoute):
    def get_route_handler(self):
            original_handler = super().get_route_handler()

            async def limited_handler(request: Request):
                body = await request.body()

                if len(body) > MAX_REQ_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail="Request body is too large",
                    )

                return await original_handler(request)

            return limited_handler




app = FastAPI()
app.router.route_class = SizeLimitedRoute

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
IgnoredWord = Annotated[str, Field(max_length=100)]
class SpellcheckRequest(BaseModel):
    sentence: str = Field(max_length=20000)
    cursor_position: int = Field(ge=0)
    ignored_words: list[IgnoredWord] = Field(default_factory=list, max_length=500)

@app.get("/health")
def health_check():
    try:
        check_languagetool_health()
    except requests.RequestException:
        return JSONResponse(
            status_code=503,
            content={
                "status": "degraded",
                "languagetool": "unavailable",
            },
        )

    return {
        "status": "ok",
        "languagetool": "ok",
    }

@app.post("/spellcheck")
@limiter.limit("60/minute")
def spellcheck(request: Request, payload: SpellcheckRequest):
    try:
        return find_misspelled_word(
            payload.sentence,
            payload.cursor_position,
            payload.ignored_words,
        )
    except requests.RequestException:
        raise HTTPException(
            status_code=503,
            detail="LanguageTool is unavailable",
        )
    

@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)

    if request.url.path == "/spellcheck":
        response.headers["Cache-Control"] = "no-store"

    return response