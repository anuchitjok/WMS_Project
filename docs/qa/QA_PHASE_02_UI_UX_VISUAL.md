# PHASE 02 – FULL UI/UX AND VISUAL AUDIT

## OBJECTIVE
Inspect every WMS page visually using actual browser rendering and screenshots.

The objective is to identify layout defects, incorrect dimensions, overflow, text clipping, overlapping elements, and inconsistent UI components.

Source code inspection alone is not sufficient.

## 1. VIEWPORT TESTING

Test all pages at:

- 1920 × 1080
- 1440 × 900
- 1366 × 768
- 1024 × 768
- 768 × 1024
- 390 × 844

## 2. CONTAINER AND BOX DIMENSIONS

Inspect:
- Card width and height.
- Container boundaries.
- Padding and margins.
- Grid dimensions.
- Flex alignment.
- Unexpected overflow.
- Content outside parent containers.
- Inconsistent component sizing.

## 3. TYPOGRAPHY

Inspect:
- Font size.
- Font weight.
- Line height.
- Text alignment.
- Text wrapping.
- Text truncation.
- Text clipping.
- Long labels.
- Numbers and IDs.
- Thai and Chinese character rendering.

## 4. OVERLAPPING

Identify:
- Text overlapping icons.
- Buttons overlapping other controls.
- Cards overlapping.
- Dropdown hidden behind other elements.
- Modal layering issues.
- Incorrect z-index.
- Sticky headers covering content.
- Sidebar covering the main content.
- Tooltip positioning problems.
- Floating elements blocking interactions.

## 5. TABLES

Inspect:
- Column widths.
- Header alignment.
- Row heights.
- Long text.
- Horizontal scrolling.
- Pagination.
- Action buttons.
- Empty states.
- Loading states.

## 6. DASHBOARD AND CHARTS

Inspect:
- KPI cards.
- Charts.
- Labels.
- Legends.
- Axis text.
- Data values.
- Responsive behavior.
- Card alignment.
- Consistent spacing.

## 7. INTERACTIVE COMPONENTS

Inspect every:
- Button.
- Input.
- Dropdown.
- Select.
- Checkbox.
- Radio.
- Tab.
- Modal.
- Tooltip.
- Menu.
- Navigation element.

## 8. MULTILINGUAL VISUAL QA

Repeat inspection in:
- English.
- Thai.
- Simplified Chinese.

Verify that changing languages does not cause overflow, broken layouts, or clipped text.

## 9. 3D WAREHOUSE QA

Where implemented, inspect:
- Normal Warehouse mode.
- Open Warehouse mode.
- Rack positions.
- Rack labels.
- Object visibility.
- Camera controls.
- Zoom and rotation.
- Fullscreen.
- Toolbar.
- UI overlays.
- Responsive layout.

## 10. SCREENSHOT EVIDENCE

Capture actual screenshots.

Every defect must include:
- Page name.
- Component name.
- Viewport.
- Language.
- Screenshot.
- Defect description.
- Expected result.
- Actual result.
- Severity.
- Recommended fix.

Save screenshots in:
`docs/qa/reports/screenshots/`

Update:
`docs/qa/reports/QA_VISUAL_DEFECTS.md`

## RESTRICTIONS

Do not change CSS, HTML, components, or source code.

Complete Phase 02 only and stop for approval.