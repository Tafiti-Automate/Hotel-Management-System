"""Controlled supplier-facing procurement documents."""

from io import BytesIO
from html import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
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


def _logo(hotel):
    if not hotel or not hotel.logo:
        return None
    try:
        hotel.logo.open("rb")
        content = BytesIO(hotel.logo.read())
        hotel.logo.close()
        logo = Image(content, width=49 * mm, height=22 * mm, kind="proportional")
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
):
    """Return a complete LPO PDF suitable for printing or email attachment."""
    buffer = BytesIO()
    hotel = order.requisition.hotel
    styles = getSampleStyleSheet()
    normal = ParagraphStyle(
        "LpoNormal",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=8.5,
        leading=10.5,
        textColor=colors.HexColor("#172033"),
    )
    small = ParagraphStyle("LpoSmall", parent=normal, fontSize=7.2, leading=8.8)
    heading = ParagraphStyle(
        "LpoHeading",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=15,
        leading=18,
        alignment=TA_CENTER,
        spaceAfter=2 * mm,
    )
    classification_style = ParagraphStyle(
        "LpoClassification",
        parent=normal,
        fontName="Helvetica-Bold",
        fontSize=9,
        leading=11,
        alignment=TA_CENTER,
        textColor=colors.HexColor("#b42318") if "COPY" in classification.upper() else colors.HexColor("#166534"),
    )
    right = ParagraphStyle("LpoRight", parent=normal, alignment=TA_RIGHT)

    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=13 * mm,
        leftMargin=13 * mm,
        topMargin=11 * mm,
        bottomMargin=13 * mm,
        title=f"Local Purchase Order {order.po_number}",
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
        [[branding, Paragraph("<br/>".join(hotel_lines), right)]],
        colWidths=[88 * mm, 94 * mm],
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
        [Paragraph("Terms of Payment", small), Paragraph(f": {_text(order.supplier.payment_terms)}", normal)],
    ]
    order_data = [
        [Paragraph("LPO No.", small), Paragraph(f": <b>{_text(order.po_number)}</b>", normal)],
        [Paragraph("Requisition No.", small), Paragraph(f": {_text(order.requisition.requisition_number)}", normal)],
        [Paragraph("Delivery Date", small), Paragraph(f": {_date(delivery_date or order.delivery_due_date or order.expected_date)}", normal)],
        [Paragraph("LPO Submit Date", small), Paragraph(f": {_date(created_date)}", normal)],
        [Paragraph("Order Valid Until", small), Paragraph(f": {_date(order.valid_until)}", normal)],
        [Paragraph("Status", small), Paragraph(f": {_text(order.get_status_display())}", normal)],
        [Paragraph("Currency", small), Paragraph(f": {_text(order.requisition.currency)}", normal)],
        [Paragraph("Supply To", small), Paragraph(f": {_text(', '.join(destinations))}", normal)],
    ]
    supplier_table = Table(supplier_data, colWidths=[29 * mm, 61 * mm])
    order_table = Table(order_data, colWidths=[34 * mm, 56 * mm])
    for table in (supplier_table, order_table):
        table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 1),
            ("TOPPADDING", (0, 0), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
    meta = Table([[supplier_table, order_table]], colWidths=[92 * mm, 90 * mm])
    meta.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    line_rows = [[
        Paragraph("Article", small),
        Paragraph("Qty", small),
        Paragraph("UoM", small),
        Paragraph("Unit Price", small),
        Paragraph("Disc", small),
        Paragraph("VAT", small),
        Paragraph("Net", small),
    ]]
    for line in order.items.select_related("item", "unit", "item__base_unit").all():
        unit_name = line.unit.abbreviation if line.unit else (
            line.item.base_unit.abbreviation if line.item.base_unit else line.item.unit
        )
        line_rows.append([
            Paragraph(f"{_text(line.item.sku)} &nbsp; {_text(line.item.name)}", normal),
            Paragraph(_money(line.approved_quantity), right),
            Paragraph(_text(unit_name), normal),
            Paragraph(_money(line.unit_cost), right),
            Paragraph("0.00%", right),
            Paragraph("0.00%", right),
            Paragraph(_money(line.line_total), right),
        ])
    lines = Table(
        line_rows,
        repeatRows=1,
        colWidths=[65 * mm, 19 * mm, 19 * mm, 26 * mm, 15 * mm, 15 * mm, 23 * mm],
    )
    lines.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#d9dde3")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, 0), 0.45, colors.HexColor("#4b5563")),
        ("LINEBELOW", (0, -1), (-1, -1), 0.35, colors.HexColor("#c7cdd6")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))

    total_table = Table([
        [Paragraph("Net Amount", small), Paragraph(_money(order.total_amount), right)],
        [Paragraph("VAT 0.00%", small), Paragraph("0.00", right)],
        [Paragraph(f"<b>Total Amount {_text(order.requisition.currency)}</b>", normal), Paragraph(f"<b>{_money(order.total_amount)}</b>", right)],
    ], colWidths=[45 * mm, 32 * mm])
    total_table.hAlign = "RIGHT"
    total_table.setStyle(TableStyle([
        ("LINEABOVE", (0, 2), (-1, 2), 0.6, colors.black),
        ("LINEBELOW", (0, 2), (-1, 2), 0.9, colors.black),
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
    ]], colWidths=[105 * mm, 77 * mm])
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
    for approval in order.approval_workflow.select_related("approver__user").all():
        approval_rows.append([
            Paragraph(f"Level {approval.stage}", small),
            Paragraph("OK" if approval.status == "approved" else _text(approval.get_status_display()), small),
            Paragraph(_text(approval.approver.user.get_full_name() or approval.approver.user.username), small),
            Paragraph(_text(approval.stage_name), small),
            Paragraph(_datetime(approval.decided_at), small),
        ])
    approvals = Table(
        approval_rows,
        repeatRows=1,
        colWidths=[19 * mm, 22 * mm, 48 * mm, 53 * mm, 40 * mm],
    )
    approvals.setStyle(TableStyle([
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#6b7280")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))

    story = [
        header,
        Spacer(1, 7 * mm),
        Paragraph("LOCAL PURCHASE ORDER", heading),
        Paragraph(_text(classification), classification_style),
        Spacer(1, 7 * mm),
        meta,
        Spacer(1, 4 * mm),
        Paragraph(
            f"<i>Requested By:</i> &nbsp; <b>{_text(requested_by)}</b>"
            f" &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <i>Printed By:</i> &nbsp; <b>{_text(printed_name)}</b>",
            normal,
        ),
        Spacer(1, 2 * mm),
        lines,
        Spacer(1, 9 * mm),
        KeepTogether([conditions_table]),
        Spacer(1, 7 * mm),
        Paragraph(
            "<b>This LPO has been electronically approved and therefore substitutes a hand-written signature, as follows:</b>",
            normal,
        ),
        Spacer(1, 2 * mm),
        approvals,
    ]

    def footer(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor("#596579"))
        website = hotel.website if hotel and hotel.website else "Generated by Hotel Management System"
        canvas.drawString(13 * mm, 7 * mm, website)
        canvas.drawRightString(A4[0] - 13 * mm, 7 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
