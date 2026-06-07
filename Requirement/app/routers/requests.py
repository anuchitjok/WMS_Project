from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from database import get_db
import models, auth as auth_utils

router = APIRouter(prefix="/api/requests", tags=["requests"])

class RequestItemIn(BaseModel):
    product_id: int
    quantity_requested: float
    serial_number: Optional[str] = None

class RequestIn(BaseModel):
    department: str
    rma_case_number: Optional[str] = None
    purpose: Optional[str] = None
    required_date: Optional[datetime] = None
    priority: str = "normal"
    notes: Optional[str] = None
    items: List[RequestItemIn]

class RequestOut(BaseModel):
    id: int
    ref_number: str
    department: str
    rma_case_number: Optional[str]
    purpose: Optional[str]
    status: str
    priority: str
    requester_id: int
    approver_id: Optional[int]
    reject_reason: Optional[str]
    notes: Optional[str]
    created_at: Optional[datetime]
    class Config: from_attributes = True

def _gen_ref():
    return f"WR{datetime.now().strftime('%Y%m%d%H%M%S')}"

def _audit(db, user_id, action, entity_id, detail):
    db.add(models.AuditLog(user_id=user_id, action=action,
                           entity_type="withdrawal_request", entity_id=entity_id, detail=detail))

# ─── Create Request ───────────────────────────────────────────────────────────

@router.post("/", response_model=RequestOut)
def create_request(data: RequestIn, db: Session = Depends(get_db),
                   current_user=Depends(auth_utils.get_current_user)):
    # Validate items
    for item in data.items:
        product = db.query(models.Product).get(item.product_id)
        if not product: raise HTTPException(400, f"Product {item.product_id} not found")

        # Check available stock
        available = db.query(models.StockItem).filter(
            models.StockItem.product_id == item.product_id,
            models.StockItem.status == models.StockStatus.AVAILABLE
        ).count()
        if available < item.quantity_requested:
            raise HTTPException(400, f"Insufficient stock for {product.code}: available {available}")

        # Duplicate RMA check
        if data.rma_case_number:
            dup = db.query(models.WithdrawalRequestItem).join(models.WithdrawalRequest).filter(
                models.WithdrawalRequest.rma_case_number == data.rma_case_number,
                models.WithdrawalRequestItem.product_id == item.product_id,
                models.WithdrawalRequest.status.notin_(["rejected", "cancelled"])
            ).first()
            if dup:
                raise HTTPException(400, f"Duplicate request: product {product.code} for RMA {data.rma_case_number}")

    req = models.WithdrawalRequest(
        ref_number=_gen_ref(), requester_id=current_user.id,
        department=data.department, rma_case_number=data.rma_case_number,
        purpose=data.purpose, required_date=data.required_date,
        priority=data.priority, status=models.RequestStatus.SUBMITTED,
        notes=data.notes
    )
    db.add(req); db.flush()

    for item in data.items:
        db.add(models.WithdrawalRequestItem(
            request_id=req.id, product_id=item.product_id,
            quantity_requested=item.quantity_requested,
            serial_number=item.serial_number
        ))

    _audit(db, current_user.id, "CREATE_REQUEST", req.id, f"Created {req.ref_number}")
    db.commit(); db.refresh(req)
    return req

# ─── List Requests ────────────────────────────────────────────────────────────

@router.get("/", response_model=List[RequestOut])
def list_requests(status: Optional[str] = None, db: Session = Depends(get_db),
                  current_user=Depends(auth_utils.get_current_user)):
    q = db.query(models.WithdrawalRequest)

    # Requesters see only their own; warehouse/admin see all
    if current_user.role in (models.UserRole.REQUESTER, models.UserRole.RMA_TEAM):
        q = q.filter(models.WithdrawalRequest.requester_id == current_user.id)
    elif current_user.role == models.UserRole.DEPT_APPROVER:
        q = q.filter(models.WithdrawalRequest.department == current_user.department)

    if status:
        q = q.filter(models.WithdrawalRequest.status == status)
    return q.order_by(models.WithdrawalRequest.created_at.desc()).limit(200).all()

@router.get("/{req_id}", response_model=RequestOut)
def get_request(req_id: int, db: Session = Depends(get_db),
                _=Depends(auth_utils.get_current_user)):
    req = db.query(models.WithdrawalRequest).get(req_id)
    if not req: raise HTTPException(404, "Request not found")
    return req

# ─── Approve / Reject ─────────────────────────────────────────────────────────

class ApprovalIn(BaseModel):
    action: str  # approve | reject
    reject_reason: Optional[str] = None
    items: Optional[List[dict]] = None  # [{request_item_id, quantity_approved}]

@router.post("/{req_id}/approve")
def approve_request(req_id: int, data: ApprovalIn, db: Session = Depends(get_db),
                    current_user=Depends(auth_utils.require_roles(
                        models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
                        models.UserRole.DEPT_APPROVER))):
    req = db.query(models.WithdrawalRequest).get(req_id)
    if not req: raise HTTPException(404, "Request not found")
    if req.status != models.RequestStatus.SUBMITTED:
        raise HTTPException(400, f"Cannot approve request with status: {req.status}")

    if data.action == "approve":
        req.status = models.RequestStatus.APPROVED
        req.approver_id = current_user.id
        req.approved_at = datetime.utcnow()
        # Reserve stock for each item
        for ri in req.items:
            available = db.query(models.StockItem).filter(
                models.StockItem.product_id == ri.product_id,
                models.StockItem.status == models.StockStatus.AVAILABLE
            ).limit(int(ri.quantity_requested)).all()
            for si in available:
                si.status = models.StockStatus.RESERVED
            ri.quantity_approved = ri.quantity_requested
            ri.stock_item_id = available[0].id if available else None
        _audit(db, current_user.id, "APPROVE_REQUEST", req.id, f"Approved {req.ref_number}")
    elif data.action == "reject":
        req.status = models.RequestStatus.REJECTED
        req.approver_id = current_user.id
        req.reject_reason = data.reject_reason
        _audit(db, current_user.id, "REJECT_REQUEST", req.id,
               f"Rejected {req.ref_number}: {data.reject_reason}")
    else:
        raise HTTPException(400, "action must be 'approve' or 'reject'")

    db.commit()
    return {"message": f"Request {data.action}d successfully"}

# ─── Pick / Pack / Ship ───────────────────────────────────────────────────────

@router.post("/{req_id}/pick")
def start_picking(req_id: int, db: Session = Depends(get_db),
                  current_user=Depends(auth_utils.require_roles(
                      models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
                      models.UserRole.WAREHOUSE_SUPERVISOR, models.UserRole.WAREHOUSE_STAFF))):
    req = db.query(models.WithdrawalRequest).get(req_id)
    if not req: raise HTTPException(404, "Request not found")
    if req.status != models.RequestStatus.APPROVED:
        raise HTTPException(400, "Request must be approved before picking")
    req.status = models.RequestStatus.PICKING
    for ri in req.items:
        if ri.stock_item_id:
            db.query(models.StockItem).filter(
                models.StockItem.id == ri.stock_item_id
            ).update({"status": models.StockStatus.PICKING})
    _audit(db, current_user.id, "START_PICKING", req.id, f"Picking started: {req.ref_number}")
    db.commit()
    return {"message": "Picking started"}

@router.post("/{req_id}/pack")
def pack_request(req_id: int, db: Session = Depends(get_db),
                 current_user=Depends(auth_utils.require_roles(
                     models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
                     models.UserRole.WAREHOUSE_SUPERVISOR, models.UserRole.WAREHOUSE_STAFF))):
    req = db.query(models.WithdrawalRequest).get(req_id)
    if not req or req.status != models.RequestStatus.PICKING:
        raise HTTPException(400, "Request must be in picking status")
    req.status = models.RequestStatus.PACKED
    for ri in req.items:
        if ri.stock_item_id:
            db.query(models.StockItem).filter(
                models.StockItem.id == ri.stock_item_id
            ).update({"status": models.StockStatus.PACKED})
    _audit(db, current_user.id, "PACK_REQUEST", req.id, f"Packed: {req.ref_number}")
    db.commit()
    return {"message": "Packing complete"}

@router.post("/{req_id}/ship")
def ship_request(req_id: int, db: Session = Depends(get_db),
                 current_user=Depends(auth_utils.require_roles(
                     models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
                     models.UserRole.WAREHOUSE_SUPERVISOR, models.UserRole.WAREHOUSE_STAFF))):
    req = db.query(models.WithdrawalRequest).get(req_id)
    if not req or req.status != models.RequestStatus.PACKED:
        raise HTTPException(400, "Request must be packed before shipping")
    req.status = models.RequestStatus.ISSUED_TO_RMA
    for ri in req.items:
        if ri.stock_item_id:
            db.query(models.StockItem).filter(
                models.StockItem.id == ri.stock_item_id
            ).update({"status": models.StockStatus.ISSUED_TO_RMA})
        ri.quantity_issued = ri.quantity_approved or ri.quantity_requested
    _audit(db, current_user.id, "SHIP_REQUEST", req.id, f"Issued: {req.ref_number}")
    db.commit()
    return {"message": "Issued to RMA"}

# ─── Confirm Usage ────────────────────────────────────────────────────────────

class UsageIn(BaseModel):
    request_item_id: int
    usage_status: str  # consumed, doa, defective, unused, wrong_item
    usage_notes: Optional[str] = None

@router.post("/{req_id}/confirm-usage")
def confirm_usage(req_id: int, data: UsageIn, db: Session = Depends(get_db),
                  current_user=Depends(auth_utils.get_current_user)):
    req = db.query(models.WithdrawalRequest).get(req_id)
    if not req: raise HTTPException(404, "Request not found")
    ri = db.query(models.WithdrawalRequestItem).get(data.request_item_id)
    if not ri or ri.request_id != req_id:
        raise HTTPException(400, "Invalid request item")

    ri.usage_status = data.usage_status
    ri.usage_notes = data.usage_notes

    if ri.stock_item_id:
        status_map = {
            "consumed": models.StockStatus.CONSUMED,
            "doa": models.StockStatus.DOA,
            "defective": models.StockStatus.QUARANTINE,
            "unused": models.StockStatus.RETURNED_UNUSED,
            "wrong_item": models.StockStatus.RETURNED_UNUSED,
        }
        new_status = status_map.get(data.usage_status, models.StockStatus.CONSUMED)
        db.query(models.StockItem).filter(
            models.StockItem.id == ri.stock_item_id
        ).update({"status": new_status})

        # Auto-create RTV if DOA
        if data.usage_status == "doa":
            rtv_ref = f"RTV{datetime.now().strftime('%Y%m%d%H%M%S')}"
            rtv = models.RTVCase(
                ref_number=rtv_ref, stock_item_id=ri.stock_item_id,
                reason="doa", description=data.usage_notes,
                status=models.RTVStatus.RTV_REQUIRED
            )
            db.add(rtv)

    # Check if all items confirmed → complete request
    all_confirmed = all(i.usage_status for i in req.items)
    if all_confirmed:
        req.status = models.RequestStatus.COMPLETED

    _audit(db, current_user.id, "CONFIRM_USAGE", req.id,
           f"Item {data.request_item_id}: {data.usage_status}")
    db.commit()
    return {"message": "Usage confirmed"}

# ─── Cancel ───────────────────────────────────────────────────────────────────

@router.post("/{req_id}/cancel")
def cancel_request(req_id: int, db: Session = Depends(get_db),
                   current_user=Depends(auth_utils.get_current_user)):
    req = db.query(models.WithdrawalRequest).get(req_id)
    if not req: raise HTTPException(404, "Request not found")
    if req.status in (models.RequestStatus.SHIPPED, models.RequestStatus.COMPLETED):
        raise HTTPException(400, "Cannot cancel a shipped or completed request")
    # Release reserved stock
    for ri in req.items:
        if ri.stock_item_id:
            db.query(models.StockItem).filter(
                models.StockItem.id == ri.stock_item_id,
                models.StockItem.status == models.StockStatus.RESERVED
            ).update({"status": models.StockStatus.AVAILABLE})
    req.status = models.RequestStatus.CANCELLED
    _audit(db, current_user.id, "CANCEL_REQUEST", req.id, f"Cancelled {req.ref_number}")
    db.commit()
    return {"message": "Request cancelled"}
