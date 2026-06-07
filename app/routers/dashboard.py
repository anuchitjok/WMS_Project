from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case
from database import get_db
import models, auth as auth_utils
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("/executive")
def executive_dashboard(db: Session = Depends(get_db),
                        _=Depends(auth_utils.get_current_user)):
    # Stock counts by status
    stock_by_status = db.query(
        models.StockItem.status,
        func.count(models.StockItem.id).label("count"),
        func.sum(models.StockItem.quantity).label("total_qty")
    ).group_by(models.StockItem.status).all()

    status_map = {r.status: {"count": r.count, "qty": float(r.total_qty or 0)}
                  for r in stock_by_status}

    # Stock value (available items with cost)
    value_result = db.query(
        func.sum(models.StockItem.quantity * models.Product.unit_cost)
    ).join(models.Product, models.StockItem.product_id == models.Product.id)\
     .filter(models.StockItem.status == models.StockStatus.AVAILABLE).scalar()

    # Stock by warehouse
    by_warehouse = db.query(
        models.Warehouse.name,
        func.count(models.StockItem.id).label("items")
    ).join(models.StockItem, models.Warehouse.id == models.StockItem.warehouse_id, isouter=True)\
     .filter(models.StockItem.status == models.StockStatus.AVAILABLE)\
     .group_by(models.Warehouse.name).all()

    # Requests this month
    month_start = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0)
    requests_this_month = db.query(models.WithdrawalRequest)\
        .filter(models.WithdrawalRequest.created_at >= month_start).count()

    # Pending items
    pending_approval = db.query(models.WithdrawalRequest)\
        .filter(models.WithdrawalRequest.status == models.RequestStatus.SUBMITTED).count()
    pending_picking = db.query(models.WithdrawalRequest)\
        .filter(models.WithdrawalRequest.status == models.RequestStatus.APPROVED).count()

    # RTV pending
    rtv_pending = db.query(models.RTVCase)\
        .filter(models.RTVCase.status.in_([
            models.RTVStatus.RTV_REQUIRED, models.RTVStatus.PENDING_REVIEW,
            models.RTVStatus.APPROVED, models.RTVStatus.PENDING_SHIPMENT
        ])).count()

    # Inventory aging: items older than 90 days
    cutoff_90 = datetime.utcnow() - timedelta(days=90)
    aging_items = db.query(models.StockItem)\
        .filter(models.StockItem.status == models.StockStatus.AVAILABLE,
                models.StockItem.received_date <= cutoff_90).count()

    # Low stock products
    total_products = db.query(models.Product).filter(models.Product.is_active == True).count()

    return {
        "stock_overview": {
            "available": status_map.get("available", {}).get("qty", 0),
            "reserved": status_map.get("reserved", {}).get("qty", 0),
            "doa": status_map.get("doa", {}).get("qty", 0),
            "quarantine": status_map.get("quarantine", {}).get("qty", 0),
            "rtv_pending": status_map.get("rtv_pending", {}).get("qty", 0),
        },
        "stock_value_thb": float(value_result or 0),
        "by_warehouse": [{"name": r.name, "items": r.items} for r in by_warehouse],
        "requests": {
            "this_month": requests_this_month,
            "pending_approval": pending_approval,
            "pending_picking": pending_picking,
        },
        "rtv_open_cases": rtv_pending,
        "aging_items_90d": aging_items,
        "total_products": total_products,
    }

@router.get("/warehouse")
def warehouse_dashboard(db: Session = Depends(get_db),
                        _=Depends(auth_utils.require_roles(
                            models.UserRole.SYSTEM_ADMIN, models.UserRole.WAREHOUSE_MANAGER,
                            models.UserRole.WAREHOUSE_SUPERVISOR, models.UserRole.WAREHOUSE_STAFF))):
    return {
        "pending_receiving": db.query(models.GoodsReceiving)
            .filter(models.GoodsReceiving.status == "pending_inspection").count(),
        "pending_picking": db.query(models.WithdrawalRequest)
            .filter(models.WithdrawalRequest.status == models.RequestStatus.APPROVED).count(),
        "in_picking": db.query(models.WithdrawalRequest)
            .filter(models.WithdrawalRequest.status == models.RequestStatus.PICKING).count(),
        "packed_ready": db.query(models.WithdrawalRequest)
            .filter(models.WithdrawalRequest.status == models.RequestStatus.PACKED).count(),
        "available_stock": db.query(models.StockItem)
            .filter(models.StockItem.status == models.StockStatus.AVAILABLE).count(),
        "doa_items": db.query(models.StockItem)
            .filter(models.StockItem.status == models.StockStatus.DOA).count(),
        "quarantine_items": db.query(models.StockItem)
            .filter(models.StockItem.status == models.StockStatus.QUARANTINE).count(),
    }

@router.get("/requester")
def requester_dashboard(db: Session = Depends(get_db),
                        current_user=Depends(auth_utils.get_current_user)):
    base = db.query(models.WithdrawalRequest)\
             .filter(models.WithdrawalRequest.requester_id == current_user.id)
    return {
        "open_requests": base.filter(models.WithdrawalRequest.status.notin_(
            ["completed", "cancelled", "rejected"])).count(),
        "pending_approval": base.filter(models.WithdrawalRequest.status == "submitted").count(),
        "in_progress": base.filter(models.WithdrawalRequest.status.in_(
            ["approved", "picking", "picked", "packed"])).count(),
        "completed_this_month": base.filter(
            models.WithdrawalRequest.status == "completed",
            models.WithdrawalRequest.updated_at >= datetime.utcnow().replace(
                day=1, hour=0, minute=0)
        ).count(),
        "rejected": base.filter(models.WithdrawalRequest.status == "rejected").count(),
    }

@router.get("/audit-log")
def audit_log(skip: int = 0, limit: int = 50, db: Session = Depends(get_db),
              _=Depends(auth_utils.require_roles(
                  models.UserRole.SYSTEM_ADMIN, models.UserRole.AUDITOR,
                  models.UserRole.WAREHOUSE_MANAGER))):
    logs = db.query(models.AuditLog)\
             .order_by(models.AuditLog.created_at.desc())\
             .offset(skip).limit(limit).all()
    return [{"id": l.id, "user_id": l.user_id, "action": l.action,
             "entity_type": l.entity_type, "entity_id": l.entity_id,
             "detail": l.detail, "created_at": l.created_at} for l in logs]
