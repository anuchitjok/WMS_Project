from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from database import Base
import enum

# ─── Enums ────────────────────────────────────────────────────────────────────

class UserRole(str, enum.Enum):
    SYSTEM_ADMIN        = "system_admin"
    WAREHOUSE_MANAGER   = "warehouse_manager"
    WAREHOUSE_SUPERVISOR= "warehouse_supervisor"
    WAREHOUSE_STAFF     = "warehouse_staff"
    REQUESTER           = "requester"
    DEPT_APPROVER       = "dept_approver"
    RMA_TEAM            = "rma_team"
    RTV_OFFICER         = "rtv_officer"
    FINANCE_VIEWER      = "finance_viewer"
    BRAND_VIEWER        = "brand_viewer"
    MGMT_VIEWER         = "mgmt_viewer"
    AUDITOR             = "auditor"

class StockStatus(str, enum.Enum):
    PENDING_RECEIVING   = "pending_receiving"
    PENDING_INSPECTION  = "pending_inspection"
    AVAILABLE           = "available"
    RESERVED            = "reserved"
    PICKING             = "picking"
    PICKED              = "picked"
    PACKED              = "packed"
    READY_FOR_PICKUP    = "ready_for_pickup"
    SHIPPED             = "shipped"
    ISSUED_TO_RMA       = "issued_to_rma"
    CONSUMED            = "consumed"
    RETURNED_UNUSED     = "returned_unused"
    QUARANTINE          = "quarantine"
    DAMAGED             = "damaged"
    DOA                 = "doa"
    RTV_PENDING         = "rtv_pending"
    RTV_SHIPPED         = "rtv_shipped"
    CLOSED              = "closed"
    CANCELLED           = "cancelled"

class RequestStatus(str, enum.Enum):
    DRAFT               = "draft"
    SUBMITTED           = "submitted"
    PENDING_APPROVAL    = "pending_approval"
    APPROVED            = "approved"
    REJECTED            = "rejected"
    PICKING             = "picking"
    PICKED              = "picked"
    PACKED              = "packed"
    READY_FOR_PICKUP    = "ready_for_pickup"
    SHIPPED             = "shipped"
    ISSUED_TO_RMA       = "issued_to_rma"
    COMPLETED           = "completed"
    CANCELLED           = "cancelled"

class RTVStatus(str, enum.Enum):
    RTV_REQUIRED        = "rtv_required"
    PENDING_REVIEW      = "pending_review"
    APPROVED            = "approved"
    PENDING_SHIPMENT    = "pending_shipment"
    SHIPPED_TO_VENDOR   = "shipped_to_vendor"
    VENDOR_RECEIVED     = "vendor_received"
    REPLACEMENT_PENDING = "replacement_pending"
    CREDIT_NOTE_PENDING = "credit_note_pending"
    COMPLETED           = "completed"
    REJECTED_BY_VENDOR  = "rejected_by_vendor"
    CANCELLED           = "cancelled"

class OwnershipType(str, enum.Enum):
    CONSIGNMENT = "consignment"
    OWN         = "own"
    RMA         = "rma"
    CUSTOMER    = "customer"

# ─── Master Tables ─────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"
    id          = Column(Integer, primary_key=True, index=True)
    username    = Column(String(50), unique=True, index=True, nullable=False)
    full_name   = Column(String(100), nullable=False)
    email       = Column(String(100), unique=True)
    password    = Column(String(200), nullable=False)
    role        = Column(String(50), nullable=False, default=UserRole.REQUESTER)
    department  = Column(String(100))
    is_active   = Column(Boolean, default=True)
    created_at  = Column(DateTime, server_default=func.now())

class Brand(Base):
    __tablename__ = "brands"
    id          = Column(Integer, primary_key=True, index=True)
    code        = Column(String(20), unique=True, nullable=False)
    name        = Column(String(100), nullable=False)
    contact     = Column(String(200))
    is_active   = Column(Boolean, default=True)
    products    = relationship("Product", back_populates="brand")

class Vendor(Base):
    __tablename__ = "vendors"
    id          = Column(Integer, primary_key=True, index=True)
    code        = Column(String(20), unique=True, nullable=False)
    name        = Column(String(100), nullable=False)
    contact     = Column(String(200))
    email       = Column(String(100))
    is_active   = Column(Boolean, default=True)

class Warehouse(Base):
    __tablename__ = "warehouses"
    id          = Column(Integer, primary_key=True, index=True)
    code        = Column(String(20), unique=True, nullable=False)
    name        = Column(String(100), nullable=False)
    location    = Column(String(200))
    is_active   = Column(Boolean, default=True)
    racks       = relationship("Rack", back_populates="warehouse")

class Rack(Base):
    __tablename__ = "racks"
    id           = Column(Integer, primary_key=True, index=True)
    warehouse_id = Column(Integer, ForeignKey("warehouses.id"), nullable=False)
    code         = Column(String(20), nullable=False)
    name         = Column(String(100))
    warehouse    = relationship("Warehouse", back_populates="racks")
    slots        = relationship("Slot", back_populates="rack")

class Slot(Base):
    __tablename__ = "slots"
    id       = Column(Integer, primary_key=True, index=True)
    rack_id  = Column(Integer, ForeignKey("racks.id"), nullable=False)
    code     = Column(String(20), nullable=False)
    name     = Column(String(100))
    rack     = relationship("Rack", back_populates="slots")

class Product(Base):
    __tablename__ = "products"
    id                = Column(Integer, primary_key=True, index=True)
    code              = Column(String(50), unique=True, nullable=False, index=True)
    name              = Column(String(200), nullable=False)
    description       = Column(Text)
    brand_id          = Column(Integer, ForeignKey("brands.id"))
    category          = Column(String(100))
    unit              = Column(String(20), default="unit")
    unit_cost         = Column(Float, default=0)
    serial_controlled = Column(Boolean, default=False)
    min_stock         = Column(Integer, default=0)
    is_active         = Column(Boolean, default=True)
    created_at        = Column(DateTime, server_default=func.now())
    brand             = relationship("Brand", back_populates="products")
    stock_items       = relationship("StockItem", back_populates="product")

# ─── Stock ────────────────────────────────────────────────────────────────────

class StockItem(Base):
    __tablename__ = "stock_items"
    id              = Column(Integer, primary_key=True, index=True)
    product_id      = Column(Integer, ForeignKey("products.id"), nullable=False)
    serial_number   = Column(String(100), index=True)
    batch_number    = Column(String(100))
    quantity        = Column(Float, default=1)
    status          = Column(String(50), default=StockStatus.AVAILABLE)
    ownership_type  = Column(String(30), default=OwnershipType.OWN)
    warehouse_id    = Column(Integer, ForeignKey("warehouses.id"))
    rack_id         = Column(Integer, ForeignKey("racks.id"))
    slot_id         = Column(Integer, ForeignKey("slots.id"))
    received_date   = Column(DateTime, server_default=func.now())
    expiry_date     = Column(DateTime, nullable=True)
    notes           = Column(Text)
    created_by      = Column(Integer, ForeignKey("users.id"))
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())

    product         = relationship("Product", back_populates="stock_items")
    warehouse       = relationship("Warehouse")
    rack            = relationship("Rack")
    slot            = relationship("Slot")

class GoodsReceiving(Base):
    __tablename__ = "goods_receiving"
    id              = Column(Integer, primary_key=True, index=True)
    ref_number      = Column(String(50), unique=True, nullable=False)
    source_type     = Column(String(50))  # brand, vendor, rma, rtv_replacement, internal
    source_ref      = Column(String(100))
    received_by     = Column(Integer, ForeignKey("users.id"))
    received_date   = Column(DateTime, server_default=func.now())
    status          = Column(String(50), default="pending_inspection")
    notes           = Column(Text)
    items           = relationship("GoodsReceivingItem", back_populates="receiving")

class GoodsReceivingItem(Base):
    __tablename__ = "goods_receiving_items"
    id              = Column(Integer, primary_key=True, index=True)
    receiving_id    = Column(Integer, ForeignKey("goods_receiving.id"), nullable=False)
    product_id      = Column(Integer, ForeignKey("products.id"), nullable=False)
    serial_number   = Column(String(100))
    quantity        = Column(Float, default=1)
    condition       = Column(String(50), default="good")  # good, damaged, doa
    stock_item_id   = Column(Integer, ForeignKey("stock_items.id"))
    receiving       = relationship("GoodsReceiving", back_populates="items")

# ─── Withdrawal Requests ──────────────────────────────────────────────────────

class WithdrawalRequest(Base):
    __tablename__ = "withdrawal_requests"
    id              = Column(Integer, primary_key=True, index=True)
    ref_number      = Column(String(50), unique=True, nullable=False, index=True)
    requester_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    department      = Column(String(100), nullable=False)
    rma_case_number = Column(String(100))
    purpose         = Column(Text)
    required_date   = Column(DateTime)
    status          = Column(String(50), default=RequestStatus.DRAFT)
    priority        = Column(String(20), default="normal")  # low, normal, high, urgent
    approver_id     = Column(Integer, ForeignKey("users.id"))
    approved_at     = Column(DateTime)
    reject_reason   = Column(Text)
    notes           = Column(Text)
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())

    requester       = relationship("User", foreign_keys=[requester_id])
    approver        = relationship("User", foreign_keys=[approver_id])
    items           = relationship("WithdrawalRequestItem", back_populates="request")

class WithdrawalRequestItem(Base):
    __tablename__ = "withdrawal_request_items"
    id                  = Column(Integer, primary_key=True, index=True)
    request_id          = Column(Integer, ForeignKey("withdrawal_requests.id"), nullable=False)
    product_id          = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity_requested  = Column(Float, nullable=False)
    quantity_approved   = Column(Float)
    quantity_issued     = Column(Float, default=0)
    serial_number       = Column(String(100))
    stock_item_id       = Column(Integer, ForeignKey("stock_items.id"))
    usage_status        = Column(String(50))  # consumed, doa, defective, unused, wrong_item
    usage_notes         = Column(Text)
    request             = relationship("WithdrawalRequest", back_populates="items")
    product             = relationship("Product")
    stock_item          = relationship("StockItem")

# ─── RTV ──────────────────────────────────────────────────────────────────────

class RTVCase(Base):
    __tablename__ = "rtv_cases"
    id              = Column(Integer, primary_key=True, index=True)
    ref_number      = Column(String(50), unique=True, nullable=False)
    stock_item_id   = Column(Integer, ForeignKey("stock_items.id"), nullable=False)
    reason          = Column(String(50), nullable=False)  # doa, defective, vendor_return
    description     = Column(Text)
    status          = Column(String(50), default=RTVStatus.RTV_REQUIRED)
    vendor_id       = Column(Integer, ForeignKey("vendors.id"))
    rtv_officer_id  = Column(Integer, ForeignKey("users.id"))
    shipment_ref    = Column(String(100))
    shipped_date    = Column(DateTime)
    vendor_response = Column(Text)
    resolution      = Column(String(50))  # replacement, credit_note, repair
    credit_note_ref = Column(String(100))
    replacement_stock_id = Column(Integer, ForeignKey("stock_items.id"))
    closed_at       = Column(DateTime)
    notes           = Column(Text)
    created_at      = Column(DateTime, server_default=func.now())
    updated_at      = Column(DateTime, server_default=func.now(), onupdate=func.now())

    stock_item      = relationship("StockItem", foreign_keys=[stock_item_id])
    vendor          = relationship("Vendor")
    rtv_officer     = relationship("User", foreign_keys=[rtv_officer_id])

# ─── Audit Log ────────────────────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"))
    action      = Column(String(100), nullable=False)
    entity_type = Column(String(50))
    entity_id   = Column(Integer)
    detail      = Column(Text)
    ip_address  = Column(String(50))
    created_at  = Column(DateTime, server_default=func.now())
    user        = relationship("User")
