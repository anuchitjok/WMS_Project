# SKILL.md — HSNT WMS Demo & Prototype Development Guide

## 1. Purpose

This skill file defines the working rules, structure, and development standards for creating and improving the Highpoint Service Network Thailand (HSNT) Warehouse Management System (WMS) demo prototype.

The prototype is designed for customer presentation, internal discussion, SOP alignment, and future system development planning.

---

## 2. Project Context

HSNT WMS manages:

- Consignment parts
- Spare parts
- Finished goods
- RMA-related inventory
- DOA items
- Defective items
- RTV items
- Unused stock returns
- Warehouse locations, racks, slots, and bins
- Request, approval, pick, pack, ship, handover, and audit workflows

The system should support warehouse operations for locations such as:

- Tower B1FL
- Tower B2FL
- Tower C1FL
- SCG Warehouse
- RTV / Quarantine holding area

---

## 3. Core Design Principle

The WMS must be separated into four major portals:

### 3.1 Admin System

Responsible for system governance and setup.

Main functions:

- User management
- Role management
- Permission setup
- Product master
- Brand master
- Vendor master
- Warehouse master
- Rack / slot master
- Reason code master
- Warranty rule setup
- Approval workflow setup
- Notification setup
- Audit log and system configuration

### 3.2 Warehouse Management

Responsible for physical warehouse operations.

Main functions:

- Goods receiving
- Receiving verification
- Product inspection
- Putaway
- Inventory stock inquiry
- Stock transfer
- Stock adjustment
- Picking
- Packing
- Label printing
- Shipment
- Handover confirmation
- Cycle count
- Warehouse dashboard

### 3.3 Requester Portal

Responsible for stock withdrawal and RMA usage confirmation.

Main functions:

- Create withdrawal request
- Track request status
- View request history
- Confirm RMA usage
- Mark item as used / consumed
- Declare DOA or defective item
- Submit unused goods return
- Upload supporting documents or photos

### 3.4 RTV Management

Responsible for DOA and vendor return processing.

Main functions:

- DOA review
- Defective item review
- RTV case creation
- RTV approval
- Vendor return document
- Shipment tracking
- Vendor response tracking
- Replacement tracking
- Credit note tracking
- RTV closure

---

## 4. Recommended User Roles

The demo should support the following roles:

1. System Administrator
2. Warehouse Manager
3. Warehouse Supervisor
4. Warehouse Staff
5. Requester
6. Department Approver
7. RMA / Service Team
8. RTV Officer
9. Finance / Accounting Viewer
10. Brand / Vendor Viewer
11. Management Viewer
12. Auditor

Each role should see only relevant menus and actions.

---

## 5. Key Workflow

### 5.1 Goods Receiving Flow

1. Goods arrive from brand, vendor, customer, internal transfer, RMA return, or RTV replacement.
2. Warehouse staff verify documents and physical goods.
3. Product master is checked or created.
4. Receiving transaction is created.
5. Quantity and condition are verified.
6. Goods are assigned to warehouse, rack, slot, or temporary location.
7. Stock status is updated.

Recommended statuses:

- Pending Receiving
- Pending Inspection
- Available
- Quarantine
- Damaged
- DOA
- RTV Pending

### 5.2 Withdrawal Request Flow

1. Requester creates withdrawal request.
2. System validates required fields, RMA case, stock quantity, serial number, ownership type, and duplicate request.
3. Request goes to approval.
4. Approved request creates stock reservation.
5. Warehouse starts picking.

Recommended statuses:

- Draft
- Submitted
- Pending Approval
- Approved
- Rejected
- Picking
- Picked
- Packed
- Ready for Pickup
- Shipped
- Issued to RMA
- Completed
- Cancelled

### 5.3 Pick / Pack / Ship Flow

1. Warehouse receives picking task.
2. Staff pick stock using location and item validation.
3. Serial number is verified if required.
4. Item is packed.
5. Label is printed.
6. Goods are prepared for pickup or shipment.
7. Handover is confirmed by receiver.

### 5.4 RMA Usage Flow

After goods are issued, requester or RMA team must confirm usage result:

- Used / Consumed
- DOA
- Defective after testing
- Wrong item
- Unused
- Return to warehouse required
- Return to vendor required

### 5.5 RTV Flow

RTV is triggered when:

- Item is DOA
- Item is defective
- Vendor return is required
- Brand owner requires defective part return
- Warranty replacement is required

Recommended statuses:

- RTV Required
- Pending RTV Review
- RTV Approved
- Pending Return Shipment
- Shipped to Vendor
- Vendor Received
- Replacement Pending
- Credit Note Pending
- Completed
- Rejected by Vendor
- Cancelled

### 5.6 Unused Goods Return Flow

1. Requester submits unused return request.
2. Warehouse verifies original request, quantity, serial number, and condition.
3. Warehouse decides whether to:
   - Return to available stock
   - Move to quarantine
   - Reject return
   - Move to RTV pending
4. Stock and audit records are updated.

---

## 6. Inventory Status Design

Use the following inventory statuses:

- Pending Receiving
- Pending Inspection
- Available
- Reserved
- Picking
- Picked
- Packed
- Ready for Pickup
- Shipped
- Issued to RMA
- Consumed
- Returned Unused
- Quarantine
- Damaged
- DOA
- RTV Pending
- RTV Shipped
- Closed
- Cancelled

---

## 7. Validation Rules

### 7.1 Receiving Validation

- Product code must exist before receiving.
- Serial number is mandatory for serial-controlled items.
- Duplicate serial numbers are not allowed for active stock.
- Damaged or DOA items cannot become available stock.
- Ownership type is mandatory.
- Warehouse location must be assigned before stock becomes available.

### 7.2 Request Validation

- Requester must be active.
- Department is mandatory.
- RMA case number is mandatory for RMA-related requests.
- Requested quantity cannot exceed available quantity.
- Required usage date cannot be earlier than request date.
- Duplicate request warning should appear for same RMA and same product.
- Approval is required for restricted or high-value items.

### 7.3 Pick / Pack / Ship Validation

- Only approved requests can be picked.
- Picker must confirm correct item and location.
- Picked quantity cannot exceed approved quantity.
- Serial number must match the approved item.
- Shipment cannot proceed before packing confirmation.
- Completion requires receiver confirmation.

### 7.4 RMA Usage Validation

- Usage update is required after withdrawal.
- Consumed quantity + returned quantity + DOA quantity must equal issued quantity.
- DOA declaration requires reason and evidence.
- Unused return must reference original withdrawal request.
- Returned serial number must match issued serial number.

### 7.5 RTV Validation

- RTV case must reference DOA or defective item.
- RTV shipment requires vendor or brand information.
- RTV closure requires vendor response or internal approval.
- Replacement stock must return through receiving process.

---

## 8. Dashboard Requirements

### Executive Dashboard

- Total inventory quantity
- Total stock value
- Stock by brand
- Stock by warehouse
- Consignment stock balance
- Finished goods balance
- DOA quantity
- RTV pending quantity
- Inventory aging
- Warehouse utilization
- Monthly withdrawal volume
- Request completion SLA

### Warehouse Dashboard

- Pending receiving
- Pending putaway
- Pending picking
- Pending packing
- Ready for pickup
- Overdue pickup
- Low stock items
- Location capacity usage

### Requester Dashboard

- My open requests
- Pending approval
- Ready for pickup
- Pending usage update
- Unused return pending
- Completed requests

### RTV Dashboard

- RTV pending cases
- RTV shipped cases
- Vendor response pending
- Replacement pending
- Credit note pending
- RTV aging
- RTV by brand
- DOA rate by product

---

## 9. UI/UX Guidelines

Use a modern SaaS dashboard style:

- Clean layout
- Clear module separation
- Left sidebar navigation
- Portal tabs
- KPI cards
- Status badges
- Workflow task board
- Search and filter controls
- Modal forms
- Notification center
- Audit trail table
- Customer-friendly English wording

Recommended visual style:

- Professional teal / navy color palette
- Rounded cards
- Soft shadows
- Status badges with color coding
- Tables for operational data
- Kanban board for pick / pack / ship
- Dashboard cards for KPI summary

---

## 10. Prototype Requirements

The demo prototype should be a single `index.html` file.

It should include:

- No external backend dependency
- Embedded CSS
- Embedded JavaScript
- Mock data
- Role switcher
- Role-based menu visibility
- Interactive status updates
- Request creation modal
- Receiving modal
- Product master modal
- Notification center
- Audit log update after actions

---

## 11. File Naming Standard

Recommended output names:

- `HSNT_WMS_English_Demo_index.html`
- `HSNT_WMS_English_Demo_Separated_Modules.html`
- `HSNT_WMS_SOP.pdf`
- `HSNT_WMS_SOP_Presentation.pptx`
- `HSNT_WMS_SKILL.md`

---

## 12. Quality Checklist

Before delivering any WMS prototype or document, check that it includes:

- Clear module separation
- Correct warehouse process flow
- Correct requester flow
- Correct RTV / DOA flow
- Correct inventory statuses
- Clear user roles
- Role-based access concept
- Validation rules
- Audit trail concept
- Dashboard and reporting concept
- Customer-friendly wording
- Professional visual style
- English version for customer presentation

---

## 13. Recommended Future Enhancements

- Barcode / QR code scanning
- Mobile warehouse app
- RMA system integration
- Vendor portal
- SLA monitoring
- Inventory forecasting
- DOA trend analytics
- RTV aging analytics
- Cycle count automation
- Power BI dashboard integration

---

## 14. Development Note

This skill file should be used as the guiding standard when generating:

- WMS demo UI
- SOP document
- PowerPoint presentation
- Business requirement document
- Workflow diagram
- Database structure
- User permission matrix
- Customer presentation material

The priority is to make the WMS clear, professional, structured, and easy for customers and developers to understand.
