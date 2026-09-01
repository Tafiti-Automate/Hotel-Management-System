"""Controlled supplier-facing procurement documents."""

from io import BytesIO
from html import escape
from decimal import Decimal, InvalidOperation
import re

from django.conf import settings

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


def _text(value):
    return escape(str(value or "—"))


def _date(value):
    if not value:
        return "—"
    if hasattr(value, "date") and hasattr(value, "hour"):
        value = value.date()
    return value.strftime("%d.%B.%Y")


def _datetime(value):
    if not value:
        return "—"
    return value.strftime("%d.%m.%Y %I:%M %p")


def _money(value):
    return f"{value or 0:,.2f}"


def _vat_rate():
    """Document VAT rate, configurable as a fraction (0.18) or percent (18)."""
    try:
        rate = Decimal(str(getattr(settings, "VAT_RATE", "0.18")))
    except (InvalidOperation, TypeError, ValueError):
        rate = Decimal("0.18")
    if rate > 1:
        rate = rate / Decimal("100")
    return max(rate, Decimal("0.00"))


def _payment_terms_days(value):
    match = re.search(r"\d+", str(value or ""))
    if not match:
        return "—"
    days = int(match.group(0))
    return f"{days} Day" if days == 1 else f"{days} Days"


def _order_status(order):
    return {
        "approved": "Not Received",
        "issued": "Not Received",
        "partially_received": "Partially Received",
        "received": "Received",
        "cancelled": "Cancelled",
    }.get(order.status, order.get_status_display())


def _logo(hotel):
    if not hotel or not hotel.logo:
        return None
    try:
        hotel.logo.open("rb")
        content = BytesIO(hotel.logo.read())
        hotel.logo.close()
        logo = Image(content, width=58 * mm, height=23 * mm, kind="proportional")
        logo.hAlign = "LEFT"
        return logo
    except (OSError, ValueError):
        return None


def build_purchase_order_pdf(
    order,
    *,
    classification,
    printed_by=None,
    delivery_date=None,
    actor_label="Printed By",
):
    """Return a complete LPO PDF suitable for printing or email attachment."""
    buffer = BytesIO()
    hotel = order.requisition.hotel
    styles = getSampleStyleSheet()
    normal = ParagraphStyle(
        "LpoNormal",
        parent=styles["Normal"],
        fontName="Times-Roman",
        fontSize=8.2,
        leading=9.6,
        textColor=colors.black,
    )
    small = ParagraphStyle("LpoSmall", parent=normal, fontSize=7.4, leading=8.6)
    heading = ParagraphStyle(
        "LpoHeading",
        parent=styles["Heading1"],
        fontName="Times-Bold",
        fontSize=14,
        leading=16,
        alignment=TA_CENTER,
        spaceAfter=1 * mm,
    )
    classification_style = ParagraphStyle(
        "LpoClassification",
        parent=normal,
        fontName="Times-Bold",
        fontSize=8.2,
        leading=9.5,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#b42318") if "COPY" in classification.upper() else colors.HexColor("#166534"),
    )
    right = ParagraphStyle("LpoRight", parent=normal, alignment=TA_RIGHT)
    company_right = ParagraphStyle(
        "LpoCompanyRight",
        parent=right,
        fontSize=9.2,
        leading=10.5,
    )

    document = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=12 * mm,
        leftMargin=12 * mm,
        topMargin=10 * mm,
        bottomMargin=12 * mm,
        title=f"Local Purchase Order {order.lpo_number}",
        author=hotel.name if hotel else "Hotel Management System",
    )

    hotel_name = (hotel.legal_name or hotel.name) if hotel else "Hotel property"
    address_parts = []
    if hotel:
        address_parts.extend(part for part in (hotel.address, hotel.city, hotel.country) if part)
    hotel_lines = [f"<b>{_text(hotel_name)}</b>"]
    if address_parts:
        hotel_lines.append("<br/>".join(_text(part) for part in address_parts))
    if hotel and hotel.tax_identification_number:
        hotel_lines.append(f"TIN: {_text(hotel.tax_identification_number)}")
    if hotel and hotel.phone:
        hotel_lines.append(f"Tel: {_text(hotel.phone)}")
    if hotel and hotel.email:
        hotel_lines.append(_text(hotel.email))

    branding = _logo(hotel) or Paragraph(_text(hotel.name if hotel else "HOTEL"), heading)
    header = Table(
        [[branding, Paragraph("<br/>".join(hotel_lines), company_right)]],
        colWidths=[92 * mm, 99 * mm],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    created_date = order.submitted_for_approval_at or order.created_at
    requested_by = order.requisition.requester or order.ordered_by
    printed_name = (
        printed_by.get_full_name() or printed_by.username
        if printed_by
        else "Electronic document"
    )
    destinations = []
    for line in order.items.select_related(
        "destination_store", "destination_department"
    ).all():
        destination = line.destination_department if line.destination_type == "workspace" else line.destination_store
        if destination and str(destination) not in destinations:
            destinations.append(str(destination))
    if not destinations and order.store:
        destinations.append(str(order.store))

    supplier_data = [
        [Paragraph("Supplier", small), Paragraph(f": <b>{_text(order.supplier.name)}</b>", normal)],
        [Paragraph("Phone", small), Paragraph(f": {_text(order.supplier.phone)}", normal)],
        [Paragraph("E-mail", small), Paragraph(f": {_text(order.supplier.email)}", normal)],
        [Paragraph("TIN", small), Paragraph(f": {_text(order.supplier.tin_number)}", normal)],
        [Paragraph("Address", small), Paragraph(f": {_text(order.supplier.address)}", normal)],
        [Paragraph("Terms of Payment", small), Paragraph(f": {_text(_payment_terms_days(order.supplier.payment_terms))}", normal)],
    ]
    order_data = [
        [Paragraph("LPO No.", small), Paragraph(f": <b>{_text(order.lpo_number)}</b>", normal)],
        [Paragraph("PO No.", small), Paragraph(f": {_text(order.po_number)}", normal)],
        [Paragraph("Requisition No.", small), Paragraph(f": {_text(order.requisition.requisition_number)}", normal)],
        [Paragraph("Delivery Date", small), Paragraph(f": {_date(delivery_date or order.delivery_due_date or order.expected_date)}", normal)],
        [Paragraph("LPO Submit Date", small), Paragraph(f": {_date(created_date)}", normal)],
        [Paragraph("Order Valid Until", small), Paragraph(f": {_date(order.valid_until)}", normal)],
        [Paragraph("Status", small), Paragraph(f": {_text(_order_status(order))}", normal)],
        [Paragraph("PO Currency", small), Paragraph(f": {_text(order.requisition.currency)}", normal)],
        [Paragraph("Supply To", small), Paragraph(f": {_text(', '.join(destinations))}", normal)],
    ]
    supplier_table = Table(supplier_data, colWidths=[30 * mm, 64 * mm])
    order_table = Table(order_data, colWidths=[32 * mm, 65 * mm])
    for table in (supplier_table, order_table):
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 1),
            ("TOPPADDING", (0, 0), (-1, -1), 0.6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0.6),
        ]))
    meta = Table([[supplier_table, order_table]], colWidths=[94 * mm, 97 * mm])
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    vat_rate = _vat_rate()
    vat_percent = vat_rate * Decimal("100")
    net_total = order.total_amount or Decimal("0.00")
    vat_total = (net_total * vat_rate).quantize(Decimal("0.01"))
    gross_total = net_total + vat_total

    line_rows = [[
        Paragraph("Article", small),
        Paragraph("Qty", small),
        Paragraph("UoM", small),
        Paragraph("Unit Price", small),
        Paragraph("Net", small),
        Paragraph("VAT %", small),
        Paragraph("Amount", small),
    ]]
    for line in order.items.select_related("item", "unit", "item__base_unit").all():
        unit_name = line.unit.abbreviation if line.unit else (
            line.item.base_unit.abbreviation if line.item.base_unit else line.item.unit
        )
        line_net = line.line_total or Decimal("0.00")
        line_amount = line_net + (line_net * vat_rate)
        line_rows.append([
            Paragraph(f"{_text(line.item.sku)} &nbsp; {_text(line.item.name)}", normal),
            Paragraph(_money(line.approved_quantity), right),
            Paragraph(_text(unit_name), normal),
            Paragraph(_money(line.unit_cost), right),
            Paragraph(_money(line_net), right),
            Paragraph(f"{vat_percent:.0f}%", right),
            Paragraph(_money(line_amount), right),
        ])
    lines = Table(
        line_rows,
        repeatRows=1,
        colWidths=[72 * mm, 17 * mm, 17 * mm, 25 * mm, 15 * mm, 15 * mm, 30 * mm],
    )
    lines.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d9dde3")),
        ("FONTNAME", (0, 0), (-1, 0), "Times-Bold"),
        ("GRID", (0, 0), (-1, 0), 0.55, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, 0), 2.2),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2.2),
        ("TOPPADDING", (0, 1), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 1.5),
    ]))

    total_table = Table([
        [Paragraph("Net Amount", small), Paragraph(_money(net_total), right)],
        [Paragraph(f"VAT {vat_percent:.0f}%", small), Paragraph(_money(vat_total), right)],
        [Paragraph(f"<b>Total Amount {_text(order.requisition.currency)}</b>", normal), Paragraph(f"<b>{_money(gross_total)}</b>", right)],
    ], colWidths=[45 * mm, 32 * mm])
    total_table.hAlign = "RIGHT"
    total_table.setStyle(TableStyle([
        ("LINEABOVE", (0, 2), (-1, 2), 0.6, colors.black),
        ("LINEBELOW", (0, 2), (-1, 2), 0.9, colors.black),
        ("LINEBELOW", (0, 2), (-1, 2), 0.3, colors.black, None, (1, 1), 1.6),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]))

    conditions = [
        f"1. This order is valid until {_date(order.valid_until)}.",
        "2. Deliveries are accepted subject to count, weight and quality.",
        "3. The LPO number must be quoted in full on delivery notes, invoices and correspondence.",
        "4. Invoice and delivery-note quantities and prices must match this LPO.",
    ]
    conditions_table = Table([[
        Paragraph("<b>Acceptance of this order is acceptance of all conditions herein</b><br/>" + "<br/>".join(conditions), small),
        total_table,
    ]], colWidths=[114 * mm, 77 * mm])
    conditions_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    approval_rows = [[
        Paragraph("Level", small),
        Paragraph("Status", small),
        Paragraph("User", small),
        Paragraph("Department / Info", small),
        Paragraph("Time", small),
    ]]
    for approval in order.approval_workflow.select_related("approver__user", "approver_role", "decided_by").all():
        if approval.decided_by_id:
            approval_user = approval.decided_by.get_full_name() or approval.decided_by.username
        elif approval.approver_id:
            approval_user = approval.approver.user.get_full_name() or approval.approver.user.username
        elif approval.approver_role_id:
            approval_user = approval.approver_role.name
        else:
            approval_user = "Pending assignment"
        approval_rows.append([
            Paragraph(f"Level {approval.stage}", small),
            Paragraph("OK" if approval.status == "approved" else _text(approval.get_status_display()), small),
            Paragraph(_text(approval_user), small),
            Paragraph(_text(approval.stage_name), small),
            Paragraph(_datetime(approval.decided_at), small),
        ])
    approvals = Table(
        approval_rows,
        repeatRows=1,
        colWidths=[19 * mm, 21 * mm, 49 * mm, 59 * mm, 43 * mm],
    )
    approvals.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Times-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
    ]))

    line_count = max(1, len(line_rows) - 1)
    approval_count = max(1, len(approval_rows) - 1)
    bottom_anchor = max(
        8,
        67 - max(0, line_count - 2) * 5.4 - max(0, approval_count - 2) * 3.4,
    )

    story = [
        header,
        Spacer(1, 4 * mm),
        Paragraph("LOCAL PURCHASE ORDER", heading),
        Paragraph(_text(classification), classification_style),
        Spacer(1, 5 * mm),
        meta,
        Spacer(1, 3 * mm),
        Paragraph(
            f"<i>Requested By :</i> &nbsp; {_text(requested_by)}"
            f" &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <i>{_text(actor_label)} :</i> &nbsp; {_text(printed_name)}",
            normal,
        ),
        Spacer(1, 1 * mm),
        lines,
        Spacer(1, bottom_anchor * mm),
        KeepTogether([conditions_table]),
        Spacer(1, 5 * mm),
        Paragraph(
            "<b>This PO has been electronically approved and therefore substitutes a hand-written signature, as follows:</b>",
            normal,
        ),
        Spacer(1, 1.5 * mm),
        approvals,
    ]

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Times-Roman", 7)
        canvas.setFillColor(colors.HexColor("#6b7280"))
        website = hotel.website if hotel and hotel.website else "Generated by Hotel Management System"
        canvas.drawString(12 * mm, 6 * mm, website)
        canvas.setFillColor(colors.black)
        canvas.drawRightString(letter[0] - 12 * mm, 6 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
