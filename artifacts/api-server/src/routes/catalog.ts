import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { fileURLToPath } from "url";
import path from "path";

const __dirnameESM = path.dirname(fileURLToPath(import.meta.url));
const PLAYFAIR_FONT = path.join(__dirnameESM, "../fonts/PlayfairDisplay-Regular.ttf");

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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

async function extractImagesFromXlsx(buffer: Buffer): Promise<Record<number, { data: Buffer; ext: string }>> {
  const imageMap: Record<number, { data: Buffer; ext: string }> = {};
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: () => false });

    const drawingFiles = Object.keys(zip.files).filter(f => f.match(/xl\/drawings\/drawing\d+\.xml$/));

    for (const drawingPath of drawingFiles) {
      const drawingIndex = drawingPath.match(/drawing(\d+)\.xml$/)?.[1] || "1";
      const relsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;
      const relsFile = zip.file(relsPath);
      const drawingFile = zip.file(drawingPath);
      if (!relsFile || !drawingFile) continue;

      const relsContent = await relsFile.async("text");
      const relsDoc = xmlParser.parse(relsContent);
      const rIdToPath: Record<string, string> = {};
      const rels = relsDoc?.Relationships?.Relationship;
      const relArray = Array.isArray(rels) ? rels : rels ? [rels] : [];
      for (const rel of relArray) {
        const id = rel["@_Id"];
        const target = String(rel["@_Target"] || "");
        if (id && target) {
          const resolved = target.startsWith("../") ? "xl/" + target.slice(3) : target;
          rIdToPath[id] = resolved;
        }
      }

      const drawingContent = await drawingFile.async("text");
      const drawingDoc = xmlParser.parse(drawingContent);
      const wsDr = drawingDoc["xdr:wsDr"] || drawingDoc["wsDr"] || {};

      const extractAnchors = (key: string): unknown[] => {
        const v = wsDr[key];
        if (!v) return [];
        return Array.isArray(v) ? v : [v];
      };

      const anchors = [...extractAnchors("xdr:twoCellAnchor"), ...extractAnchors("xdr:oneCellAnchor")];

      for (const anchor of anchors as Record<string, unknown>[]) {
        const fromSection = anchor["xdr:from"] as Record<string, unknown> | undefined;
        const rowRaw = fromSection?.["xdr:row"];
        const row = rowRaw !== undefined ? Number(rowRaw) : undefined;
        const pic = anchor["xdr:pic"] as Record<string, unknown> | undefined;
        const blipFill = pic?.["xdr:blipFill"] as Record<string, unknown> | undefined;
        const blip = blipFill?.["a:blip"] as Record<string, unknown> | undefined;
        const rId = blip?.["@_r:embed"] as string | undefined;

        if (row !== undefined && rId && rIdToPath[rId]) {
          const imgFile = zip.file(rIdToPath[rId]);
          if (imgFile) {
            const data = await imgFile.async("nodebuffer");
            const ext = rIdToPath[rId].split(".").pop()?.toLowerCase() || "png";
            imageMap[row] = { data, ext };
          }
        }
      }
    }
  } catch (err) {
    console.error("Image extraction error:", err);
  }
  return imageMap;
}

// ─── Sample Excel download ───────────────────────────────────────────────────
router.get("/sample", (_req, res) => {
  const wb = XLSX.utils.book_new();
  const headers = [
    "Sr No",
    "Title",
    "10K Weight",
    "14K Weight",
    "18K Weight",
    "Center Diamond Weight",
    "Side Diamond Weight",
  ];
  const sampleRows = [
    [1, "Solitaire Diamond Ring", 2.500, 2.750, 3.000, 0.50, 0.25],
    [2, "Diamond Stud Earrings", 1.800, 2.000, 2.200, 0.30, 0.10],
    [3, "Tennis Bracelet", 5.200, 5.800, 6.500, 1.20, 0.60],
    [4, "Diamond Pendant Necklace", 1.200, 1.350, 1.500, 0.40, 0.15],
    [5, "Eternity Band Ring", 3.100, 3.450, 3.800, 0.00, 0.80],
  ];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);

  // Column widths
  ws["!cols"] = [
    { wch: 8 },
    { wch: 28 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 22 },
    { wch: 20 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Jewelry Catalog");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="gemone-catalog-sample.xlsx"');
  res.send(buf);
});

// ─── Upload ──────────────────────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, raw: false });
    const imageMap = await extractImagesFromXlsx(req.file.buffer);

    const headerRow = rows[0] as string[];
    const headerMap: Record<string, number> = {};
    if (Array.isArray(headerRow)) {
      headerRow.forEach((h: string, i: number) => { headerMap[String(h).toLowerCase().trim()] = i; });
    }

    const findCol = (names: string[]): number => {
      for (const n of names)
        for (const [key, idx] of Object.entries(headerMap))
          if (key.includes(n)) return idx;
      return -1;
    };

    const srNoCol = findCol(["sr no", "sr. no", "serial", "sr"]);
    const titleCol = findCol(["title", "name", "product"]);
    const w10kCol = findCol(["10k"]);
    const w14kCol = findCol(["14k"]);
    const w18kCol = findCol(["18k"]);
    const centerCol = findCol(["center diamond", "center"]);
    const sideCol = findCol(["side diamond", "side"]);

    const items: JewelryItem[] = [];

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
        srNo, title,
        weight10k: parseNum(w10kCol), weight14k: parseNum(w14kCol), weight18k: parseNum(w18kCol),
        centerDiamondWeight: parseNum(centerCol), sideDiamondWeight: parseNum(sideCol),
        imageBase64, imageMimeType,
      });
    }

    res.json({ items, totalRows: items.length });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: "Failed to parse Excel file" });
  }
});

// ─── Generate PDF ─────────────────────────────────────────────────────────────
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
    const YEAR = new Date().getFullYear();

    const PAGE_W = 1000;
    const PAGE_H = 1000;
    const MX = 50;
    const CW = PAGE_W - MX * 2;

    const BLACK = "#0D0D0D";
    const DARK_GRAY = "#333333";
    const MID_GRAY = "#666666";
    const LIGHT_GRAY = "#AAAAAA";
    const GOLD = "#B8860B";
    const GOLD_LIGHT = "#C9A84C";
    const RULE_COLOR = "#CCCCCC";
    const LIGHT_BG = "#FAFAF8";

    const HEADER_H = 90;
    const FOOTER_H = 44;
    const BODY_H = PAGE_H - HEADER_H - FOOTER_H;
    const ROW_H = BODY_H / 2;
    const COL_W = CW / 2;
    const CELL_PAD = 20;

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margin: 0,
      autoFirstPage: false,
      info: { Title: `Gemone Diamond ${catalogType} Catalog`, Author: "Gemone Diamond" },
    });

    // Register Playfair Display
    doc.registerFont("Playfair", PLAYFAIR_FONT);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gemone-diamond-${catalogType.toLowerCase()}-catalog.pdf"`);
    doc.pipe(res);

    const totalPages = Math.ceil(items.length / 4);

    // ── COVER PAGE ─────────────────────────────────────────────────────────────
    doc.addPage();

    const cx = PAGE_W / 2;

    // Top thin gold rule pair
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, 60).lineTo(PAGE_W - MX, 60).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 64).lineTo(PAGE_W - MX, 64).stroke();

    // "EST." tag
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
      .text(`EST. ${YEAR}  ·  FINE JEWELLERY`, 0, 74, { width: PAGE_W, align: "center", lineBreak: false });

    // Decorative diamond outline (geometric)
    const dcx = cx;
    const dcy = 210;
    const dw = 90;
    const dh = 55;
    doc.strokeColor(GOLD).lineWidth(1)
      .moveTo(dcx, dcy - dh)
      .lineTo(dcx + dw, dcy)
      .lineTo(dcx, dcy + dh)
      .lineTo(dcx - dw, dcy)
      .closePath()
      .stroke();
    // Inner smaller diamond
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4)
      .moveTo(dcx, dcy - dh + 12)
      .lineTo(dcx + dw - 18, dcy)
      .lineTo(dcx, dcy + dh - 12)
      .lineTo(dcx - dw + 18, dcy)
      .closePath()
      .stroke();

    // "GEMONE" — large Playfair, spaced, gold
    doc.fillColor(GOLD).font("Playfair").fontSize(72)
      .text("GEMONE", 0, 290, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 12 });

    // "DIAMOND" — large Playfair, spaced, black
    doc.fillColor(BLACK).font("Playfair").fontSize(52)
      .text("DIAMOND", 0, 372, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 8 });

    // Thin gold rule
    doc.strokeColor(GOLD).lineWidth(0.8).moveTo(cx - 100, 442).lineTo(cx + 100, 442).stroke();

    // Diamond dot in center of rule
    doc.fillColor(GOLD).circle(cx, 442, 3).fill();

    // "CRAFTED WITH BRILLIANCE"
    doc.fillColor(GOLD_LIGHT).font("Playfair").fontSize(14)
      .text("CRAFTED WITH BRILLIANCE", 0, 456, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 3 });

    // Thin rule below tagline
    doc.strokeColor(RULE_COLOR).lineWidth(0.4).moveTo(MX + 60, 484).lineTo(PAGE_W - MX - 60, 484).stroke();

    // Catalog type badge
    const badgeLabel = catalogType === "B2B" ? "B2B WHOLESALE COLLECTION" : "B2C RETAIL COLLECTION";
    doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11)
      .text(badgeLabel, 0, 500, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 4 });

    // Item count
    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
      .text(`${items.length} PIECES  ·  ALL KARATS  ·  EF COLOR  ·  VVS/VS CLARITY`, 0, 520, { width: PAGE_W, align: "center", lineBreak: false });

    // Mid decorative rule set
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 548).lineTo(PAGE_W - MX, 548).stroke();
    doc.strokeColor(GOLD).lineWidth(1.0).moveTo(MX, 551).lineTo(PAGE_W - MX, 551).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 554).lineTo(PAGE_W - MX, 554).stroke();

    // Karat row — three columns
    const karatY = 590;
    const karatCols = [
      { k: "10K", factor: "0.45", x: cx - 240 },
      { k: "14K", factor: "0.65", x: cx - 40 },
      { k: "18K", factor: "0.75", x: cx + 160 },
    ];
    for (const col of karatCols) {
      doc.fillColor(GOLD).font("Playfair").fontSize(22)
        .text(col.k, col.x, karatY, { width: 80, align: "center", lineBreak: false });
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
        .text("GOLD", col.x, karatY + 26, { width: 80, align: "center", lineBreak: false });
    }

    // Vertical micro-rules between karats
    doc.strokeColor(RULE_COLOR).lineWidth(0.5)
      .moveTo(cx - 80, karatY - 6).lineTo(cx - 80, karatY + 44).stroke();
    doc.strokeColor(RULE_COLOR).lineWidth(0.5)
      .moveTo(cx + 120, karatY - 6).lineTo(cx + 120, karatY + 44).stroke();

    // Bottom rule pair
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, PAGE_H - 80).lineTo(PAGE_W - MX, PAGE_H - 80).stroke();
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, PAGE_H - 76).lineTo(PAGE_W - MX, PAGE_H - 76).stroke();

    // Footer info
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
      .text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", 0, PAGE_H - 60, { width: PAGE_W, align: "center", lineBreak: false });
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7.5)
      .text(MONTH_YEAR, 0, PAGE_H - 44, { width: PAGE_W, align: "center", lineBreak: false });

    // ── CATALOG PAGES ──────────────────────────────────────────────────────────
    const drawHeader = (pageNum: number) => {
      doc.fillColor(BLACK).font("Playfair").fontSize(17)
        .text("Gemone Diamond", MX, 24, { lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5)
        .text("CRAFTED WITH BRILLIANCE", MX, 48, { lineBreak: false });

      const rightX = PAGE_W - MX - 240;
      doc.fillColor(GOLD).font("Playfair").fontSize(11)
        .text("Gemone Diamond Collection", rightX, 24, { width: 240, align: "right", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5)
        .text(`Page ${pageNum} of ${totalPages}`, rightX, 44, { width: 240, align: "right", lineBreak: false });

      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MX, HEADER_H - 4).lineTo(PAGE_W - MX, HEADER_H - 4).stroke();
    };

    const drawFooter = () => {
      const fy = PAGE_H - FOOTER_H + 12;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MX, fy - 10).lineTo(PAGE_W - MX, fy - 10).stroke();
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
        .text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", MX, fy, { lineBreak: false });
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
        .text(MONTH_YEAR, MX, fy, { width: CW, align: "right", lineBreak: false });
    };

    const drawGridLines = () => {
      const midX = MX + COL_W;
      const midY = HEADER_H + ROW_H;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(midX, HEADER_H).lineTo(midX, HEADER_H + BODY_H).stroke();
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MX, midY).lineTo(PAGE_W - MX, midY).stroke();
    };

    const drawProduct = (
      item: JewelryItem,
      cellX: number,
      cellY: number,
      config: PricingConfig,
      ct: "B2B" | "B2C",
      showCharges: boolean,
    ) => {
      const allPrices = calcAllKarats(item, config, ct);
      const innerX = cellX + CELL_PAD;
      const innerW = COL_W - CELL_PAD * 2;
      let y = cellY + CELL_PAD;

      // Title in Playfair
      doc.fillColor(BLACK).font("Playfair").fontSize(13)
        .text(item.title, innerX, y, { width: innerW, lineBreak: false, ellipsis: true });
      y += 19;

      const totalDiamond = item.centerDiamondWeight + item.sideDiamondWeight;
      const subLabel = totalDiamond > 0 ? "LAB GROWN DIAMOND" : "FINE JEWELLERY";
      doc.fillColor(GOLD_LIGHT).font("Helvetica").fontSize(7.5)
        .text(subLabel, innerX, y, { lineBreak: false });
      y += 14;

      doc.strokeColor(RULE_COLOR).lineWidth(0.3)
        .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 8;

      // Image
      const availableH = ROW_H - CELL_PAD * 2;
      const imgH = Math.round(availableH * 0.42);
      const imgW = innerW;

      if (item.imageBase64 && item.imageBase64.length > 0) {
        try {
          const imgBuf = Buffer.from(item.imageBase64, "base64");
          doc.image(imgBuf, innerX, y, { fit: [imgW, imgH], align: "center", valign: "center" });
        } catch {
          doc.rect(innerX, y, imgW, imgH).fillColor(LIGHT_BG).fill();
          doc.rect(innerX, y, imgW, imgH).strokeColor(RULE_COLOR).lineWidth(0.3).stroke();
          doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
            .text("Image Error", innerX, y + imgH / 2 - 5, { width: imgW, align: "center" });
        }
      } else {
        doc.rect(innerX, y, imgW, imgH).fillColor(LIGHT_BG).fill();
        doc.rect(innerX, y, imgW, imgH).strokeColor(RULE_COLOR).lineWidth(0.3).stroke();
        doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
          .text("No Image", innerX, y + imgH / 2 - 5, { width: imgW, align: "center" });
      }
      y += imgH + 10;

      const detailLabelW = innerW * 0.52;
      const detailValW = innerW * 0.48;

      const detailRow = (label: string, value: string) => {
        doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8)
          .text(label, innerX, y, { width: detailLabelW, lineBreak: false });
        doc.fillColor(DARK_GRAY).font("Helvetica-Bold").fontSize(8)
          .text(value, innerX + detailLabelW, y, { width: detailValW, align: "right", lineBreak: false });
        y += 12;
      };

      if (item.weight14k > 0) detailRow("Metal Weight", `${item.weight14k.toFixed(3)} g`);
      else if (item.weight10k > 0) detailRow("Metal Weight", `${item.weight10k.toFixed(3)} g`);
      else if (item.weight18k > 0) detailRow("Metal Weight", `${item.weight18k.toFixed(3)} g`);
      if (totalDiamond > 0) detailRow("Diamond", `${totalDiamond.toFixed(2)} ct`);
      detailRow("Color", DIAMOND_COLOR);
      detailRow("Clarity", DIAMOND_CLARITY);

      y += 3;
      doc.strokeColor(RULE_COLOR).lineWidth(0.3)
        .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 7;

      if (showCharges) {
        const p14 = allPrices["14K"];
        const chargeRow = (label: string, value: string) => {
          doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7.5)
            .text(label, innerX, y, { width: detailLabelW, lineBreak: false });
          doc.fillColor(DARK_GRAY).font("Helvetica").fontSize(7.5)
            .text(value, innerX + detailLabelW, y, { width: detailValW, align: "right", lineBreak: false });
          y += 11;
        };
        chargeRow("Metal (14K)", fmt(p14.metalCalcUSD));
        chargeRow("Diamond", fmt(p14.centerDiamondUSD + p14.sideDiamondUSD));
        chargeRow("Labour", fmt(p14.labourUSD));
        if (ct === "B2B" && p14.wastageUSD > 0) chargeRow("Wastage", fmt(p14.wastageUSD));
        chargeRow(`Handling (${config.handlingPercent}%)`, fmt(p14.handlingUSD));
        if (ct === "B2C") chargeRow(`Profit (${config.profitPercent}%)`, fmt(p14.profitUSD));
        if (ct === "B2B" && config.adminChargePercent > 0) chargeRow(`Admin (${config.adminChargePercent}%)`, fmt(p14.adminUSD));

        y += 3;
        doc.strokeColor(RULE_COLOR).lineWidth(0.3)
          .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
        y += 7;
      }

      // Karat price strip
      const karats: KaratKey[] = ["10K", "14K", "18K"];
      const karatW = innerW / 3;

      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatW;
        doc.fillColor(GOLD_LIGHT).font("Helvetica").fontSize(7.5)
          .text(k + " Gold", kx, y, { width: karatW, align: "center", lineBreak: false });
      });
      y += 13;

      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatW;
        doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(10)
          .text(fmt(allPrices[k].total), kx, y, { width: karatW, align: "center", lineBreak: false });
      });
    };

    let pageNum = 0;
    for (let i = 0; i < items.length; i += 4) {
      pageNum++;
      doc.addPage();
      drawHeader(pageNum);
      drawFooter();
      drawGridLines();

      const pageItems = items.slice(i, i + 4);
      const positions = [
        { x: MX, y: HEADER_H },
        { x: MX + COL_W, y: HEADER_H },
        { x: MX, y: HEADER_H + ROW_H },
        { x: MX + COL_W, y: HEADER_H + ROW_H },
      ];

      pageItems.forEach((item, idx) => {
        drawProduct(item, positions[idx].x, positions[idx].y, pricingConfig, catalogType, showItemizedCharges);
      });
    }

    doc.end();
  } catch (err) {
    console.error("Generate error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate catalog" });
  }
});

export default router;
