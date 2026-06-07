from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from database import get_db
import models, auth as auth_utils

router = APIRouter(prefix="/api/rtv", tags=["rtv"])

RTV_ROLES = (models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
             models.UserRole.RTV_OFFICER)

class RTVCreate(BaseModel):
    stock_item_id: int
    reason: str  # doa, defective, vendor_return
    description: Optional[str] = None
    vendor_id: Optional[int] = None

class RTVUpdate(BaseModel):
    status: Optional[str] = None
    vendor_id: Optional[int] = None
    shipment_ref: Optional[str] = None
    shipped_date: Optional[datetime] = None
    vendor_response: Optional[str] = None
    resolution: Optional[str] = None
    credit_note_ref: Optional[str] = None
    notes: Optional[str] = None

class RTVOut(BaseModel):
    id: int
    ref_number: str
    stock_item_id: int
    reason: str
    description: Optional[str]
    status: str
    vendor_id: Optional[int]
    shipment_ref: Optional[str]
    shipped_date: Optional[datetime]
    vendor_response: Optional[str]
    resolution: Optional[str]
    credit_note_ref: Optional[str]
    notes: Optional[str]
    created_at: Optional[datetime]
    class Config: from_attributes = True

def _audit(db, user_id, action, entity_id, detail):
    db.add(models.AuditLog(user_id=user_id, action=action,
                           entity_type="rtv_case", entity_id=entity_id, detail=detail))

@router.get("/", response_model=List[RTVOut])
def list_rtv(status: Optional[str] = None, db: Session = Depends(get_db),
             _=Depends(auth_utils.require_roles(*RTV_ROLES))):
    q = db.query(models.RTVCase)
    if status:
        q = q.filter(models.RTVCase.status == status)
    return q.order_by(models.RTVCase.created_at.desc()).limit(200).all()

@router.post("/", response_model=RTVOut)
def create_rtv(data: RTVCreate, db: Session = Depends(get_db),
               current_user=Depends(auth_utils.require_roles(*RTV_ROLES))):
    stock = db.query(models.StockItem).get(data.stock_item_id)
    if not stock: raise HTTPException(404, "Stock item not found")
    if stock.status not in (models.StockStatus.DOA, models.StockStatus.QUARANTINE,
                            models.StockStatus.AVAILABLE):
        raise HTTPException(400, f"Stock status {stock.status} cannot be RTV'd")

    rtv_ref = f"RTV{datetime.now().strftime('%Y%m%d%H%M%S')}"
    rtv = models.RTVCase(
        ref_number=rtv_ref, stock_item_id=data.stock_item_id,
        reason=data.reason, description=data.description,
        vendor_id=data.vendor_id, status=models.RTVStatus.PENDING_REVIEW,
        rtv_officer_id=current_user.id
    )
    stock.status = models.StockStatus.RTV_PENDING
    db.add(rtv); db.flush()
    _audit(db, current_user.id, "CREATE_RTV", rtv.id, f"Created {rtv_ref}")
    db.commit(); db.refresh(rtv)
    return rtv

@router.patch("/{rtv_id}", response_model=RTVOut)
def update_rtv(rtv_id: int, data: RTVUpdate, db: Session = Depends(get_db),
               current_user=Depends(auth_utils.require_roles(*RTV_ROLES))):
    rtv = db.query(models.RTVCase).get(rtv_id)
    if not rtv: raise HTTPException(404, "RTV case not found")

    for k, v in data.model_dump(exclude_none=True).items():
        setattr(rtv, k, v)

    # Sync stock status based on RTV status
    stock = db.query(models.StockItem).get(rtv.stock_item_id)
    if stock and data.status:
        if data.status == models.RTVStatus.SHIPPED_TO_VENDOR:
            stock.status = models.StockStatus.RTV_SHIPPED
        elif data.status in (models.RTVStatus.COMPLETED, models.RTVStatus.CANCELLED):
            stock.status = models.StockStatus.CLOSED

    _audit(db, current_user.id, "UPDATE_RTV", rtv.id,
           f"Status → {data.status or 'unchanged'}")
    db.commit(); db.refresh(rtv)
    return rtv

@router.get("/{rtv_id}", response_model=RTVOut)
def get_rtv(rtv_id: int, db: Session = Depends(get_db),
            _=Depends(auth_utils.require_roles(*RTV_ROLES))):
    rtv = db.query(models.RTVCase).get(rtv_id)
    if not rtv: raise HTTPException(404, "RTV case not found")
    return rtv
