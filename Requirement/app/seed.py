"""
Seed database with initial master data and demo accounts
Run: python seed.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from database import engine, SessionLocal
import models
from auth import hash_password
from datetime import datetime

models.Base.metadata.create_all(bind=engine)
db = SessionLocal()

def seed():
    # ─── Users ────────────────────────────────────────────────────────────────
    users = [
        ("admin",      "System Administrator",  "admin@hsnt.co.th",    "admin1234",   "system_admin",         "IT"),
        ("wh_manager", "Warehouse Manager",     "wm@hsnt.co.th",       "manager1234", "warehouse_manager",    "Warehouse"),
        ("wh_staff",   "Warehouse Staff",       "ws@hsnt.co.th",       "staff1234",   "warehouse_staff",      "Warehouse"),
        ("requester1", "Anuchit Joknoianuchit", "anuchit@hsnt.co.th",  "req1234",     "requester",            "Operations"),
        ("approver1",  "Department Approver",   "approver@hsnt.co.th", "appr1234",    "dept_approver",        "Operations"),
        ("rtv_officer","RTV Officer",           "rtv@hsnt.co.th",      "rtv1234",     "rtv_officer",          "Warehouse"),
        ("mgmt_view",  "Management Viewer",     "mgmt@hsnt.co.th",     "mgmt1234",    "mgmt_viewer",          "Management"),
        ("auditor1",   "Internal Auditor",      "audit@hsnt.co.th",    "audit1234",   "auditor",              "Finance"),
    ]
    for username, full_name, email, pw, role, dept in users:
        if not db.query(models.User).filter_by(username=username).first():
            db.add(models.User(username=username, full_name=full_name, email=email,
                               password=hash_password(pw), role=role, department=dept))
    db.commit()
    print("✓ Users seeded")

    # ─── Brands ───────────────────────────────────────────────────────────────
    brands = [("CISCO","Cisco Systems","contact@cisco.com"),
              ("HP","HP Enterprise","contact@hp.com"),
              ("DELL","Dell Technologies","contact@dell.com"),
              ("HSNT","HSNT Internal","internal@hsnt.co.th")]
    for code, name, contact in brands:
        if not db.query(models.Brand).filter_by(code=code).first():
            db.add(models.Brand(code=code, name=name, contact=contact))
    db.commit()
    print("✓ Brands seeded")

    # ─── Vendors ──────────────────────────────────────────────────────────────
    vendors = [("VND001","Tech Supply Co.","02-123-4567","supply@tech.co.th"),
               ("VND002","Bangkok Parts Ltd","02-234-5678","bkk@parts.co.th")]
    for code, name, contact, email in vendors:
        if not db.query(models.Vendor).filter_by(code=code).first():
            db.add(models.Vendor(code=code, name=name, contact=contact, email=email))
    db.commit()
    print("✓ Vendors seeded")

    # ─── Warehouses ───────────────────────────────────────────────────────────
    warehouses = [
        ("WH-B1", "Tower B1FL", "Tower Building, Floor B1"),
        ("WH-B2", "Tower B2FL", "Tower Building, Floor B2"),
        ("WH-C1", "Tower C1FL", "Tower Building, Floor C1"),
        ("WH-SCG","SCG Warehouse","SCG Campus, Warehouse Zone"),
        ("WH-RTV","RTV Quarantine","Holding Area - DOA & RTV"),
    ]
    wh_map = {}
    for code, name, loc in warehouses:
        wh = db.query(models.Warehouse).filter_by(code=code).first()
        if not wh:
            wh = models.Warehouse(code=code, name=name, location=loc)
            db.add(wh); db.flush()
        wh_map[code] = wh.id
        # Add rack and slot for each warehouse
        if not db.query(models.Rack).filter_by(warehouse_id=wh.id, code="R01").first():
            rack = models.Rack(warehouse_id=wh.id, code="R01", name="Rack 01")
            db.add(rack); db.flush()
            for s in ["A1","A2","A3","B1","B2","B3"]:
                db.add(models.Slot(rack_id=rack.id, code=s, name=f"Slot {s}"))
    db.commit()
    print("✓ Warehouses seeded")

    # ─── Products ─────────────────────────────────────────────────────────────
    brand_id = db.query(models.Brand).filter_by(code="CISCO").first().id
    products = [
        ("SW-CAT-2960", "Cisco Catalyst 2960 Switch",     brand_id, "Network Switch", 45000, True),
        ("SFP-1G-SX",   "Cisco SFP Module 1G SX",         brand_id, "Transceiver",     3500, True),
        ("CAB-UTP-5E",  "UTP Cable Cat5e (Box 305m)",      brand_id, "Cable",           1200, False),
        ("PSU-650W",    "Server Power Supply 650W",         brand_id, "Power Supply",    4500, True),
        ("MEM-8G-DDR4", "RAM 8GB DDR4 ECC",                brand_id, "Memory",          2800, True),
        ("HDD-1T-SAS",  "Hard Drive 1TB SAS 7.2K",         brand_id, "Storage",         5500, True),
        ("PATCH-1M",    "Patch Cable 1M Cat6 (Pack 10)",    brand_id, "Cable",            450, False),
    ]
    for code, name, bid, cat, cost, serial in products:
        if not db.query(models.Product).filter_by(code=code).first():
            db.add(models.Product(code=code, name=name, brand_id=bid,
                                  category=cat, unit_cost=cost, serial_controlled=serial,
                                  min_stock=5))
    db.commit()
    print("✓ Products seeded")

    # ─── Demo Stock ───────────────────────────────────────────────────────────
    admin = db.query(models.User).filter_by(username="admin").first()
    wh_b1 = db.query(models.Warehouse).filter_by(code="WH-B1").first()
    wh_b2 = db.query(models.Warehouse).filter_by(code="WH-B2").first()

    stock_items = [
        ("SW-CAT-2960", "SN-SW-001", "WH-B1", "available"),
        ("SW-CAT-2960", "SN-SW-002", "WH-B1", "available"),
        ("SW-CAT-2960", "SN-SW-003", "WH-B2", "available"),
        ("SFP-1G-SX",   "SN-SFP-001","WH-B1", "available"),
        ("SFP-1G-SX",   "SN-SFP-002","WH-B1", "available"),
        ("PSU-650W",    "SN-PSU-001", "WH-B1", "available"),
        ("PSU-650W",    "SN-PSU-002", "WH-B1", "doa"),
        ("MEM-8G-DDR4", "SN-MEM-001", "WH-B2", "available"),
        ("HDD-1T-SAS",  "SN-HDD-001", "WH-B2", "available"),
        ("HDD-1T-SAS",  "SN-HDD-002", "WH-B2", "quarantine"),
    ]
    non_serial = [
        ("CAB-UTP-5E", None, "WH-B1", "available", 10),
        ("PATCH-1M",   None, "WH-B1", "available",  5),
    ]

    for prod_code, serial, wh_code, status, *qty in stock_items:
        if serial and db.query(models.StockItem).filter_by(serial_number=serial).first():
            continue
        prod = db.query(models.Product).filter_by(code=prod_code).first()
        wh = db.query(models.Warehouse).filter_by(code=wh_code).first()
        db.add(models.StockItem(product_id=prod.id, serial_number=serial,
                                quantity=1, status=status, warehouse_id=wh.id,
                                created_by=admin.id))
    for prod_code, serial, wh_code, status, qty in non_serial:
        prod = db.query(models.Product).filter_by(code=prod_code).first()
        wh = db.query(models.Warehouse).filter_by(code=wh_code).first()
        db.add(models.StockItem(product_id=prod.id, serial_number=serial,
                                quantity=qty, status=status, warehouse_id=wh.id,
                                created_by=admin.id))
    db.commit()
    print("✓ Demo stock seeded")

    print("\n" + "="*50)
    print("✅ Database seeded successfully!")
    print("\nDemo Accounts:")
    print("  admin       / admin1234   (System Admin)")
    print("  wh_manager  / manager1234 (Warehouse Manager)")
    print("  wh_staff    / staff1234   (Warehouse Staff)")
    print("  requester1  / req1234     (Requester)")
    print("  approver1   / appr1234    (Dept Approver)")
    print("  rtv_officer / rtv1234     (RTV Officer)")
    print("  mgmt_view   / mgmt1234    (Management Viewer)")
    print("="*50)

seed()
db.close()
