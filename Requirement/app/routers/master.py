from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from database import get_db
import models, auth as auth_utils

router = APIRouter(prefix="/api/master", tags=["master"])

ADMIN_MANAGER = Depends(auth_utils.require_roles(
    models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER))

# ─── Brand ────────────────────────────────────────────────────────────────────

class BrandIn(BaseModel):
    code: str; name: str; contact: Optional[str] = None

class BrandOut(BrandIn):
    id: int; is_active: bool
    class Config: from_attributes = True

@router.get("/brands", response_model=List[BrandOut])
def list_brands(db: Session = Depends(get_db), _=Depends(auth_utils.get_current_user)):
    return db.query(models.Brand).filter(models.Brand.is_active == True).all()

@router.post("/brands", response_model=BrandOut)
def create_brand(data: BrandIn, db: Session = Depends(get_db), _=ADMIN_MANAGER):
    b = models.Brand(**data.model_dump())
    db.add(b); db.commit(); db.refresh(b)
    return b

# ─── Vendor ───────────────────────────────────────────────────────────────────

class VendorIn(BaseModel):
    code: str; name: str; contact: Optional[str] = None; email: Optional[str] = None

class VendorOut(VendorIn):
    id: int; is_active: bool
    class Config: from_attributes = True

@router.get("/vendors", response_model=List[VendorOut])
def list_vendors(db: Session = Depends(get_db), _=Depends(auth_utils.get_current_user)):
    return db.query(models.Vendor).filter(models.Vendor.is_active == True).all()

@router.post("/vendors", response_model=VendorOut)
def create_vendor(data: VendorIn, db: Session = Depends(get_db), _=ADMIN_MANAGER):
    v = models.Vendor(**data.model_dump())
    db.add(v); db.commit(); db.refresh(v)
    return v

# ─── Warehouse ────────────────────────────────────────────────────────────────

class WarehouseIn(BaseModel):
    code: str; name: str; location: Optional[str] = None

class WarehouseOut(WarehouseIn):
    id: int; is_active: bool
    class Config: from_attributes = True

@router.get("/warehouses", response_model=List[WarehouseOut])
def list_warehouses(db: Session = Depends(get_db), _=Depends(auth_utils.get_current_user)):
    return db.query(models.Warehouse).filter(models.Warehouse.is_active == True).all()

@router.post("/warehouses", response_model=WarehouseOut)
def create_warehouse(data: WarehouseIn, db: Session = Depends(get_db), _=ADMIN_MANAGER):
    w = models.Warehouse(**data.model_dump())
    db.add(w); db.commit(); db.refresh(w)
    return w

# ─── Product ──────────────────────────────────────────────────────────────────

class ProductIn(BaseModel):
    code: str; name: str; description: Optional[str] = None
    brand_id: Optional[int] = None; category: Optional[str] = None
    unit: str = "unit"; unit_cost: float = 0
    serial_controlled: bool = False; min_stock: int = 0

class ProductOut(BaseModel):
    id: int; code: str; name: str; description: Optional[str]
    brand_id: Optional[int]; category: Optional[str]
    unit: str; unit_cost: float; serial_controlled: bool
    min_stock: int; is_active: bool
    class Config: from_attributes = True

@router.get("/products", response_model=List[ProductOut])
def list_products(db: Session = Depends(get_db), _=Depends(auth_utils.get_current_user)):
    return db.query(models.Product).filter(models.Product.is_active == True).all()

@router.post("/products", response_model=ProductOut)
def create_product(data: ProductIn, db: Session = Depends(get_db), _=ADMIN_MANAGER):
    if db.query(models.Product).filter(models.Product.code == data.code).first():
        raise HTTPException(400, f"Product code {data.code} already exists")
    p = models.Product(**data.model_dump())
    db.add(p); db.commit(); db.refresh(p)
    return p

@router.patch("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: int, data: ProductIn, db: Session = Depends(get_db), _=ADMIN_MANAGER):
    p = db.query(models.Product).get(product_id)
    if not p: raise HTTPException(404, "Product not found")
    for k, v in data.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit(); db.refresh(p)
    return p
