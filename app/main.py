from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from database import engine
import models
from routers import auth, users, master, stock, requests, rtv, dashboard
import os

models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="HSNT Warehouse Management System",
    description="WMS API — Highpoint Service Network Thailand",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(master.router)
app.include_router(stock.router)
app.include_router(requests.router)
app.include_router(rtv.router)
app.include_router(dashboard.router)

# Serve frontend
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/", include_in_schema=False)
def root():
    index = os.path.join(static_dir, "index.html")
    if os.path.exists(index):
        return FileResponse(index)
    return {"message": "HSNT WMS API", "docs": "/docs"}

@app.get("/health")
def health():
    return {"status": "ok", "system": "HSNT WMS v1.0"}
