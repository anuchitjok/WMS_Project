from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from database import get_db
import models, auth as auth_utils

router = APIRouter(prefix="/api/stock", tags=["stock"])

WH_ROLES = (models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
            models.UserRole.WAREHOUSE_SUPERVISOR, models.UserRole.WAREHOUSE_STAFF)

class ReceivingItemIn(BaseModel):
    product_id: int
    serial_number: Optional[str] = None
    quantity: float = 1
    condition: str = "good"

class ReceivingIn(BaseModel):
    source_type: str  # brand, vendor, rma, internal
    source_ref: Optional[str] = None
    notes: Optional[str] = None
    items: List[ReceivingItemIn]
    warehouse_id: Optional[int] = None

class StockItemOut(BaseModel):
    id: int
    product_id: int
    serial_number: Optional[str]
    quantity: float
    status: str
    ownership_type: str
    warehouse_id: Optional[int]
    rack_id: Optional[int]
    slot_id: Optional[int]
    received_date: Optional[datetime]
    notes: Optional[str]
    class Config: from_attributes = True

class StockTransferIn(BaseModel):
    stock_item_id: int
    to_warehouse_id: int
    to_rack_id: Optional[int] = None
    to_slot_id: Optional[int] = None
    notes: Optional[str] = None

class StockAdjustIn(BaseModel):
    stock_item_id: int
    new_status: str
    notes: Optional[str] = None

# ─── Receiving ────────────────────────────────────────────────────────────────

@router.post("/receive")
def receive_goods(data: ReceivingIn, db: Session = Depends(get_db),
                  current_user=Depends(auth_utils.require_roles(*WH_ROLES))):
    ref = f"GR{datetime.now().strftime('%Y%m%d%H%M%S')}"
    gr = models.GoodsReceiving(
        ref_number=ref, source_type=data.source_type,
        source_ref=data.source_ref, received_by=current_user.id,
        status="received", notes=data.notes
    )
    db.add(gr); db.flush()

    stock_created = []
    for item in data.items:
        product = db.query(models.Product).get(item.product_id)
        if not product:
            raise HTTPException(400, f"Product ID {item.product_id} not found")
        if product.serial_controlled and not item.serial_number:
            raise HTTPException(400, f"Serial number required for {product.code}")

        # Check duplicate serial
        if item.serial_number:
            existing = db.query(models.StockItem).filter(
                models.StockItem.serial_number == item.serial_number,
                models.StockItem.status.notin_(["closed", "cancelled"])
            ).first()
            if existing:
                raise HTTPException(400, f"Serial {item.serial_number} already in active stock")

        initial_status = models.StockStatus.DOA if item.condition == "doa" \
            else models.StockStatus.QUARANTINE if item.condition == "damaged" \
            else models.StockStatus.AVAILABLE

        stock = models.StockItem(
            product_id=item.product_id,
            serial_number=item.serial_number,
            quantity=item.quantity,
            status=initial_status,
            warehouse_id=data.warehouse_id,
            created_by=current_user.id
        )
        db.add(stock); db.flush()
        stock_created.append(stock.id)

        gri = models.GoodsReceivingItem(
            receiving_id=gr.id, product_id=item.product_id,
            serial_number=item.serial_number, quantity=item.quantity,
            condition=item.condition, stock_item_id=stock.id
        )
        db.add(gri)

        _audit(db, current_user.id, "RECEIVE_GOODS", "stock_item", stock.id,
               f"Received product {product.code} | Ref: {ref}")

    db.commit()
    return {"ref_number": ref, "stock_ids": stock_created, "items_received": len(stock_created)}

# ─── Stock Query ──────────────────────────────────────────────────────────────

@router.get("/items", response_model=List[StockItemOut])
def list_stock(
    status: Optional[str] = None,
    warehouse_id: Optional[int] = None,
    product_id: Optional[int] = None,
    serial: Optional[str] = None,
    skip: int = 0, limit: int = 100,
    db: Session = Depends(get_db),
    _=Depends(auth_utils.get_current_user)
):
    q = db.query(models.StockItem)
    if status:       q = q.filter(models.StockItem.status == status)
    if warehouse_id: q = q.filter(models.StockItem.warehouse_id == warehouse_id)
    if product_id:   q = q.filter(models.StockItem.product_id == product_id)
    if serial:       q = q.filter(models.StockItem.serial_number.ilike(f"%{serial}%"))
    return q.offset(skip).limit(limit).all()

@router.get("/items/{stock_id}", response_model=StockItemOut)
def get_stock_item(stock_id: int, db: Session = Depends(get_db),
                   _=Depends(auth_utils.get_current_user)):
    item = db.query(models.StockItem).get(stock_id)
    if not item: raise HTTPException(404, "Stock item not found")
    return item

# ─── Transfer ─────────────────────────────────────────────────────────────────

@router.post("/transfer")
def transfer_stock(data: StockTransferIn, db: Session = Depends(get_db),
                   current_user=Depends(auth_utils.require_roles(*WH_ROLES))):
    item = db.query(models.StockItem).get(data.stock_item_id)
    if not item: raise HTTPException(404, "Stock item not found")
    if item.status not in [models.StockStatus.AVAILABLE]:
        raise HTTPException(400, f"Cannot transfer stock with status: {item.status}")
    old_wh = item.warehouse_id
    item.warehouse_id = data.to_warehouse_id
    item.rack_id = data.to_rack_id
    item.slot_id = data.to_slot_id
    _audit(db, current_user.id, "STOCK_TRANSFER", "stock_item", item.id,
           f"Transferred WH {old_wh} → {data.to_warehouse_id}")
    db.commit()
    return {"message": "Transfer successful"}

# ─── Adjustment ───────────────────────────────────────────────────────────────

@router.post("/adjust")
def adjust_stock(data: StockAdjustIn, db: Session = Depends(get_db),
                 current_user=Depends(auth_utils.require_roles(
                     models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
                     models.UserRole.WAREHOUSE_SUPERVISOR))):
    item = db.query(models.StockItem).get(data.stock_item_id)
    if not item: raise HTTPException(404, "Stock item not found")
    old_status = item.status
    item.status = data.new_status
    _audit(db, current_user.id, "STOCK_ADJUST", "stock_item", item.id,
           f"Status: {old_status} → {data.new_status} | {data.notes or ''}")
    db.commit()
    return {"message": "Status adjusted", "new_status": data.new_status}

# ─── Summary ──────────────────────────────────────────────────────────────────

@router.get("/summary")
def stock_summary(db: Session = Depends(get_db), _=Depends(auth_utils.get_current_user)):
    rows = db.query(models.StockItem.status, func.count(models.StockItem.id).label("count"))\
             .group_by(models.StockItem.status).all()
    return {r.status: r.count for r in rows}

def _audit(db, user_id, action, entity_type, entity_id, detail):
    db.add(models.AuditLog(user_id=user_id, action=action,
                           entity_type=entity_type, entity_id=entity_id, detail=detail))
