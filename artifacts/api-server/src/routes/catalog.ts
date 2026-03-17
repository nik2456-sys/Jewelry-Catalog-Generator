import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

interface JewelryItem {
  srNo: number;
  title: string;
  weight10k: number;
  weight14k: number;
  weight18k: number;
  centerDiamondWeight: number;
  sideDiamondWeight: number;
  imageBase64?: string;
  imageMimeType?: string;
}

interface PricingConfig {
  goldPriceUSD: number;
  diamondPriceUSD: number;
  labourPerGramUSD: number;
  wastageFixedUSD: number;
  handlingPercent: number;
  profitPercent: number;
  adminChargePercent: number;
}

interface GenerateCatalogRequest {
  items: JewelryItem[];
  pricingConfig: PricingConfig;
  catalogType: "B2B" | "B2C";
  showItemizedCharges: boolean;
}

type KaratKey = "10K" | "14K" | "18K";

const KARAT_FACTORS: Record<KaratKey, number> = { "10K": 0.45, "14K": 0.65, "18K": 0.75 };

function getWeightForKarat(item: JewelryItem, karat: KaratKey): number {
  if (karat === "10K") return item.weight10k;
  if (karat === "14K") return item.weight14k;
  return item.weight18k;
}

interface KaratPrices {
  metalCalcUSD: number;
  centerDiamondUSD: number;
  sideDiamondUSD: number;
  labourUSD: number;
  wastageUSD: number;
  handlingUSD: number;
  adminUSD: number;
  profitUSD: number;
  total: number;
  weight: number;
}

function calcPricesForKarat(item: JewelryItem, config: PricingConfig, karat: KaratKey, catalogType: "B2B" | "B2C"): KaratPrices {
  const factor = KARAT_FACTORS[karat];
  const weight = getWeightForKarat(item, karat);

  const metalCalcUSD = factor * config.goldPriceUSD * weight;

  const centerDiamondUSD = item.centerDiamondWeight * config.diamondPriceUSD;
  const sideDiamondUSD = item.sideDiamondWeight * config.diamondPriceUSD;

  // Labour and wastage are now directly in USD
  const labourUSD = config.labourPerGramUSD * weight;

  if (catalogType === "B2B") {
    const wastageUSD = config.wastageFixedUSD;
    const subtotal = metalCalcUSD + centerDiamondUSD + sideDiamondUSD + labourUSD;
    const handlingUSD = subtotal * (config.handlingPercent / 100);
    const adminUSD = subtotal * (config.adminChargePercent / 100);
    const total = subtotal + wastageUSD + handlingUSD + adminUSD;
    return { metalCalcUSD, centerDiamondUSD, sideDiamondUSD, labourUSD, wastageUSD, handlingUSD, adminUSD, profitUSD: 0, total, weight };
  } else {
    const diamondCalcUSD = centerDiamondUSD + sideDiamondUSD;
    const subtotal = metalCalcUSD + diamondCalcUSD + labourUSD;
    const handlingUSD = subtotal * (config.handlingPercent / 100);
    const profitUSD = (subtotal + handlingUSD) * (config.profitPercent / 100);
    const total = subtotal + handlingUSD + profitUSD;
    return { metalCalcUSD, centerDiamondUSD, sideDiamondUSD, labourUSD, wastageUSD: 0, handlingUSD, adminUSD: 0, profitUSD, total, weight };
  }
}

function calcAllKarats(item: JewelryItem, config: PricingConfig, catalogType: "B2B" | "B2C") {
  return {
    "10K": calcPricesForKarat(item, config, "10K", catalogType),
    "14K": calcPricesForKarat(item, config, "14K", catalogType),
    "18K": calcPricesForKarat(item, config, "18K", catalogType),
  };
}

function fmt(v: number): string {
  return `$${v.toFixed(2)}`;
}

function getMonthYear(): string {
  const now = new Date();
  return now.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, raw: false });

    const items: JewelryItem[] = [];

    const imageMap: Record<number, { data: Buffer; ext: string }> = {};
    const wb = workbook as XLSX.WorkBook & {
      Sheets: { [name: string]: XLSX.WorkSheet & { "!images"?: Array<{ "!pos": { r: number; c: number }; "!data"?: string; data?: string; name?: string; ext?: string }> } };
    };
    const wsWithImages = wb.Sheets[sheetName];
    if (wsWithImages["!images"]) {
      for (const img of wsWithImages["!images"]) {
        const row = img["!pos"]?.r;
        const rawData = img["!data"] || img.data;
        const ext = img.name?.split(".").pop()?.toLowerCase() || img.ext || "png";
        if (row !== undefined && rawData) {
          const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData, "base64");
          imageMap[row] = { data: buf, ext };
        }
      }
    }

    const headerRow = rows[0] as string[];
    const headerMap: Record<string, number> = {};
    if (Array.isArray(headerRow)) {
      headerRow.forEach((h: string, i: number) => {
        const normalized = String(h).toLowerCase().trim();
        headerMap[normalized] = i;
      });
    }

    const findCol = (names: string[]): number => {
      for (const n of names) {
        for (const [key, idx] of Object.entries(headerMap)) {
          if (key.includes(n)) return idx;
        }
      }
      return -1;
    };

    const srNoCol = findCol(["sr no", "sr. no", "serial", "sr"]);
    const titleCol = findCol(["title", "name", "product"]);
    const w10kCol = findCol(["10k"]);
    const w14kCol = findCol(["14k"]);
    const w18kCol = findCol(["18k"]);
    const centerCol = findCol(["center diamond", "center"]);
    const sideCol = findCol(["side diamond", "side"]);

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as string[];
      if (!row || row.length === 0) continue;

      const parseNum = (idx: number) => {
        if (idx < 0 || idx >= row.length) return 0;
        const v = row[idx];
        if (v === undefined || v === null || v === "") return 0;
        return parseFloat(String(v).replace(/[^0-9.-]/g, "")) || 0;
      };

      const srNo = srNoCol >= 0 ? parseInt(String(row[srNoCol])) || i : i;
      const title = titleCol >= 0 ? String(row[titleCol] || `Item ${srNo}`) : `Item ${srNo}`;

      if (!title || title.trim() === "") continue;

      const imgEntry = imageMap[i];
      let imageBase64: string | undefined;
      let imageMimeType: string | undefined;

      if (imgEntry) {
        imageBase64 = imgEntry.data.toString("base64");
        imageMimeType = imgEntry.ext === "jpg" || imgEntry.ext === "jpeg" ? "image/jpeg" : `image/${imgEntry.ext}`;
      }

      items.push({
        srNo,
        title,
        weight10k: parseNum(w10kCol),
        weight14k: parseNum(w14kCol),
        weight18k: parseNum(w18kCol),
        centerDiamondWeight: parseNum(centerCol),
        sideDiamondWeight: parseNum(sideCol),
        imageBase64,
        imageMimeType,
      });
    }

    res.json({ items, totalRows: items.length });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to parse Excel file" });
  }
});

router.post("/generate", async (req, res) => {
  try {
    const body = req.body as GenerateCatalogRequest;
    const { items, pricingConfig, catalogType, showItemizedCharges } = body;

    if (!items || !pricingConfig || !catalogType) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const DIAMOND_COLOR = "EF";
    const DIAMOND_CLARITY = "VVS/VS";
    const MONTH_YEAR = getMonthYear();

    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const MARGIN_X = 45;
    const MARGIN_Y = 0;
    const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

    // Colors matching the sample PDF (clean, professional)
    const BLACK = "#0D0D0D";
    const DARK_GRAY = "#333333";
    const MID_GRAY = "#666666";
    const LIGHT_GRAY = "#AAAAAA";
    const GOLD = "#B8960C";
    const LIGHT_BG = "#FAFAF8";
    const RULE_COLOR = "#CCCCCC";

    const HEADER_H = 82;
    const FOOTER_H = 38;
    const BODY_H = PAGE_HEIGHT - HEADER_H - FOOTER_H;
    const ROW_H = BODY_H / 2;
    const COL_W = CONTENT_WIDTH / 2;
    const CELL_PAD = 16;

    const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: false, info: { Title: `Gemone Diamond ${catalogType} Catalog`, Author: "Gemone Diamond" } });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gemone-diamond-${catalogType.toLowerCase()}-catalog.pdf"`);
    doc.pipe(res);

    const totalPages = Math.ceil(items.length / 4);

    const drawHeader = (pageNum: number) => {
      // Left: Gemone Diamond + tagline
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(16)
        .text("Gemone Diamond", MARGIN_X, 24, { lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8)
        .text("CRAFTED WITH BRILLIANCE", MARGIN_X, 44, { lineBreak: false });

      // Right: Collection title + page
      const rightX = PAGE_WIDTH - MARGIN_X - 200;
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(10)
        .text("Gemone Diamond Collection", rightX, 24, { width: 200, align: "right", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8)
        .text(`Page ${pageNum} of ${totalPages}`, rightX, 40, { width: 200, align: "right", lineBreak: false });

      // Horizontal rule
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MARGIN_X, HEADER_H - 4).lineTo(PAGE_WIDTH - MARGIN_X, HEADER_H - 4).stroke();
    };

    const drawFooter = () => {
      const footerY = PAGE_HEIGHT - FOOTER_H + 10;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MARGIN_X, footerY - 8).lineTo(PAGE_WIDTH - MARGIN_X, footerY - 8).stroke();

      // Spaced out letterform
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7)
        .text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", MARGIN_X, footerY, { lineBreak: false });
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7)
        .text(MONTH_YEAR, MARGIN_X, footerY, { width: CONTENT_WIDTH, align: "right", lineBreak: false });
    };

    const drawVerticalRule = (pageY: number) => {
      // Center vertical divider
      const midX = MARGIN_X + COL_W;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(midX, pageY).lineTo(midX, pageY + BODY_H).stroke();
    };

    const drawHorizontalRule = (pageY: number) => {
      // Mid horizontal divider between rows
      const midY = pageY + ROW_H;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MARGIN_X, midY).lineTo(PAGE_WIDTH - MARGIN_X, midY).stroke();
    };

    const drawProduct = (item: JewelryItem, cellX: number, cellY: number, config: PricingConfig, ct: "B2B" | "B2C", showCharges: boolean) => {
      const allPrices = calcAllKarats(item, config, ct);
      const innerX = cellX + CELL_PAD;
      const innerW = COL_W - CELL_PAD * 2;

      let y = cellY + CELL_PAD;

      // Title
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11)
        .text(item.title, innerX, y, { width: innerW, lineBreak: false, ellipsis: true });
      y += 15;

      // Subtitle "LAB GROWN DIAMOND"
      const totalDiamond = item.centerDiamondWeight + item.sideDiamondWeight;
      const subLabel = totalDiamond > 0 ? "LAB GROWN DIAMOND" : "FINE JEWELLERY";
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7.5)
        .text(subLabel, innerX, y, { lineBreak: false });
      y += 14;

      // Small divider
      doc.strokeColor(RULE_COLOR).lineWidth(0.3)
        .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 6;

      // Image area
      const availableH = ROW_H - CELL_PAD * 2;
      const imgH = Math.round(availableH * 0.38);
      const imgW = innerW;

      if (item.imageBase64) {
        try {
          const imgBuf = Buffer.from(item.imageBase64, "base64");
          // Center the image horizontally
          doc.image(imgBuf, innerX, y, { fit: [imgW, imgH], align: "center", valign: "center" });
        } catch (_e) {
          doc.rect(innerX, y, imgW, imgH).fillColor("#F0EDE8").fill();
          doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7).text("Image", innerX, y + imgH / 2 - 4, { width: imgW, align: "center" });
        }
      } else {
        doc.rect(innerX, y, imgW, imgH).fillColor(LIGHT_BG).fill();
        doc.rect(innerX, y, imgW, imgH).strokeColor(RULE_COLOR).lineWidth(0.3).stroke();
        doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7).text("No Image", innerX, y + imgH / 2 - 4, { width: imgW, align: "center" });
      }
      y += imgH + 8;

      // --- Details table ---
      const detailLabelW = innerW * 0.52;
      const detailValW = innerW * 0.48;

      const detailRow = (label: string, value: string) => {
        doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7.5)
          .text(label, innerX, y, { width: detailLabelW, lineBreak: false });
        doc.fillColor(DARK_GRAY).font("Helvetica-Bold").fontSize(7.5)
          .text(value, innerX + detailLabelW, y, { width: detailValW, align: "right", lineBreak: false });
        y += 11;
      };

      // Metal weights
      if (item.weight10k > 0 || item.weight14k > 0 || item.weight18k > 0) {
        if (item.weight14k > 0) detailRow("Metal Weight", `${item.weight14k.toFixed(3)} g`);
        else if (item.weight10k > 0) detailRow("Metal Weight", `${item.weight10k.toFixed(3)} g`);
        else if (item.weight18k > 0) detailRow("Metal Weight", `${item.weight18k.toFixed(3)} g`);
      }

      if (totalDiamond > 0) {
        detailRow("Diamond", `${totalDiamond.toFixed(2)} ct`);
      }
      detailRow("Color", DIAMOND_COLOR);
      detailRow("Clarity", DIAMOND_CLARITY);

      y += 2;
      doc.strokeColor(RULE_COLOR).lineWidth(0.3)
        .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 6;

      // --- Itemized breakdown (if enabled, for B2B only show wastage, else hide) ---
      if (showCharges) {
        const p14 = allPrices["14K"];
        const chargeRow = (label: string, value: string) => {
          doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7)
            .text(label, innerX, y, { width: detailLabelW, lineBreak: false });
          doc.fillColor(DARK_GRAY).font("Helvetica").fontSize(7)
            .text(value, innerX + detailLabelW, y, { width: detailValW, align: "right", lineBreak: false });
          y += 10;
        };

        chargeRow("Metal (14K)", fmt(p14.metalCalcUSD));
        chargeRow("Diamond", fmt(p14.centerDiamondUSD + p14.sideDiamondUSD));
        chargeRow("Labour", fmt(p14.labourUSD));
        if (ct === "B2B" && p14.wastageUSD > 0) chargeRow("Wastage", fmt(p14.wastageUSD));
        chargeRow(`Handling (${config.handlingPercent}%)`, fmt(p14.handlingUSD));
        if (ct === "B2C") chargeRow(`Profit (${config.profitPercent}%)`, fmt(p14.profitUSD));
        if (ct === "B2B" && config.adminChargePercent > 0) chargeRow(`Admin (${config.adminChargePercent}%)`, fmt(p14.adminUSD));

        y += 2;
        doc.strokeColor(RULE_COLOR).lineWidth(0.3)
          .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
        y += 6;
      }

      // --- Karat prices ---
      const karats: KaratKey[] = ["10K", "14K", "18K"];
      const karatLabelW = innerW / 3;

      // Labels row
      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatLabelW;
        doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7)
          .text(k + " Gold", kx, y, { width: karatLabelW, align: "center", lineBreak: false });
      });
      y += 11;

      // Prices row
      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatLabelW;
        doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(9)
          .text(fmt(allPrices[k].total), kx, y, { width: karatLabelW, align: "center", lineBreak: false });
      });
    };

    let pageNum = 0;
    for (let i = 0; i < items.length; i += 4) {
      pageNum++;
      doc.addPage();

      drawHeader(pageNum);
      drawFooter();
      drawVerticalRule(HEADER_H + MARGIN_Y);
      drawHorizontalRule(HEADER_H + MARGIN_Y);

      const pageItems = items.slice(i, i + 4);
      const positions = [
        { x: MARGIN_X, y: HEADER_H + MARGIN_Y },
        { x: MARGIN_X + COL_W, y: HEADER_H + MARGIN_Y },
        { x: MARGIN_X, y: HEADER_H + MARGIN_Y + ROW_H },
        { x: MARGIN_X + COL_W, y: HEADER_H + MARGIN_Y + ROW_H },
      ];

      pageItems.forEach((item, idx) => {
        drawProduct(item, positions[idx].x, positions[idx].y, pricingConfig, catalogType, showItemizedCharges);
      });
    }

    doc.end();
  } catch (err) {
    console.error("Generate error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate catalog" });
    }
  }
});

export default router;
