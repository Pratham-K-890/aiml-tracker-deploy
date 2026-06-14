"""
Project Tracker — FastAPI entry point.

Run locally:
    cd backend
    uvicorn main:app --reload --port 8000
"""

import asyncio
import logging
import os
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from dotenv import load_dotenv
load_dotenv()  # must happen before the router imports read env vars

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from project_tracker import router as tracker_router
from chatbot import router as chatbot_router
from auth_router import router as auth_router

from fastapi.openapi.utils import get_openapi

logger = logging.getLogger("project_tracker")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Project Tracker API", version="1.0.0")


def custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(title=app.title, version=app.version, routes=app.routes)
    schema["components"]["securitySchemes"] = {
        "BearerAuth": {"type": "http", "scheme": "bearer"}
    }
    for path in schema.get("paths", {}).values():
        for op in path.values():
            op["security"] = [{"BearerAuth": []}]
    app.openapi_schema = schema
    return schema


app.openapi = custom_openapi

# ALLOWED_ORIGINS — comma-separated list of frontend origins.
# Leave unset (or set to *) to allow all origins (fine for local dev or when
# nginx is the only entry point and same-origin is guaranteed).
# Example for production: ALLOWED_ORIGINS=http://192.168.1.100,https://tracker.dept.edu
_raw_origins = os.getenv("ALLOWED_ORIGINS", "*")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc  # let FastAPI's built-in handler return the correct 4xx/5xx
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    origin = request.headers.get("origin", "*")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error."},
        headers={"Access-Control-Allow-Origin": origin},
    )

app.include_router(auth_router)
app.include_router(tracker_router)
app.include_router(chatbot_router)


@app.get("/health")
def health():
    return {"status": "ok"}
