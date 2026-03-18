import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

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

// Extract embedded images from xlsx using zip + drawing XML mapping
async function extractImagesFromXlsx(buffer: Buffer): Promise<Record<number, { data: Buffer; ext: string }>> {
  const imageMap: Record<number, { data: Buffer; ext: string }> = {};
  try {
    const zip = await JSZip.loadAsync(buffer);
    const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", isArray: () => false });

    // Find all drawing files and their rels
    const drawingFiles = Object.keys(zip.files).filter(f => f.match(/xl\/drawings\/drawing\d+\.xml$/));

    for (const drawingPath of drawingFiles) {
      const drawingIndex = drawingPath.match(/drawing(\d+)\.xml$/)?.[1] || "1";
      const relsPath = `xl/drawings/_rels/drawing${drawingIndex}.xml.rels`;

      const relsFile = zip.file(relsPath);
      const drawingFile = zip.file(drawingPath);
      if (!relsFile || !drawingFile) continue;

      // Parse relationships: rId → image file path
      const relsContent = await relsFile.async("text");
      const relsDoc = xmlParser.parse(relsContent);
      const rIdToPath: Record<string, string> = {};
      const rels = relsDoc?.Relationships?.Relationship;
      const relArray = Array.isArray(rels) ? rels : rels ? [rels] : [];
      for (const rel of relArray) {
        const id = rel["@_Id"];
        const target = String(rel["@_Target"] || "");
        if (id && target) {
          // Resolve relative path: ../media/image1.png → xl/media/image1.png
          const resolved = target.startsWith("../") ? "xl/" + target.slice(3) : target;
          rIdToPath[id] = resolved;
        }
      }

      // Parse drawing XML: row → rId mapping
      const drawingContent = await drawingFile.async("text");
      const drawingDoc = xmlParser.parse(drawingContent);

      const wsDr = drawingDoc["xdr:wsDr"] || drawingDoc["wsDr"] || {};

      const extractAnchors = (key: string): unknown[] => {
        const v = wsDr[key];
        if (!v) return [];
        return Array.isArray(v) ? v : [v];
      };

      const anchors = [
        ...extractAnchors("xdr:twoCellAnchor"),
        ...extractAnchors("xdr:oneCellAnchor"),
      ];

      for (const anchor of anchors as Record<string, unknown>[]) {
        // Get the "from" row (0-indexed)
        const fromSection = anchor["xdr:from"] as Record<string, unknown> | undefined;
        const rowRaw = fromSection?.["xdr:row"];
        const row = rowRaw !== undefined ? Number(rowRaw) : undefined;

        // Get the blip embed rId — try nested paths for pic vs sp
        const pic = anchor["xdr:pic"] as Record<string, unknown> | undefined;
        const blipFill = pic?.["xdr:blipFill"] as Record<string, unknown> | undefined;
        const blip = blipFill?.["a:blip"] as Record<string, unknown> | undefined;
        const rId = blip?.["@_r:embed"] as string | undefined;

        if (row !== undefined && rId && rIdToPath[rId]) {
          const imgFile = zip.file(rIdToPath[rId]);
          if (imgFile) {
            const data = await imgFile.async("nodebuffer");
            const ext = rIdToPath[rId].split(".").pop()?.toLowerCase() || "png";
            // row is 0-indexed; data row 1 in our parsed array = xdr:row 1
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

    // Extract images via zip
    const imageMap = await extractImagesFromXlsx(req.file.buffer);

    const headerRow = rows[0] as string[];
    const headerMap: Record<string, number> = {};
    if (Array.isArray(headerRow)) {
      headerRow.forEach((h: string, i: number) => {
        headerMap[String(h).toLowerCase().trim()] = i;
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

      // imageMap key is the 0-indexed xdr:row from the drawing
      // The data starts at row index i (1-indexed) which matches xdr:row = i (since header is row 0)
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

    // 1000 × 1000 pt page (≈ 1000 px at 72dpi)
    const PAGE_WIDTH = 1000;
    const PAGE_HEIGHT = 1000;
    const MARGIN_X = 50;
    const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

    const BLACK = "#0D0D0D";
    const DARK_GRAY = "#333333";
    const MID_GRAY = "#666666";
    const LIGHT_GRAY = "#AAAAAA";
    const RULE_COLOR = "#CCCCCC";
    const LIGHT_BG = "#FAFAF8";

    const HEADER_H = 90;
    const FOOTER_H = 44;
    const BODY_H = PAGE_HEIGHT - HEADER_H - FOOTER_H;
    const ROW_H = BODY_H / 2;
    const COL_W = CONTENT_WIDTH / 2;
    const CELL_PAD = 20;

    const doc = new PDFDocument({
      size: [PAGE_WIDTH, PAGE_HEIGHT],
      margin: 0,
      autoFirstPage: false,
      info: { Title: `Gemone Diamond ${catalogType} Catalog`, Author: "Gemone Diamond" },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gemone-diamond-${catalogType.toLowerCase()}-catalog.pdf"`);
    doc.pipe(res);

    const totalPages = Math.ceil(items.length / 4);

    const drawHeader = (pageNum: number) => {
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(18)
        .text("Gemone Diamond", MARGIN_X, 26, { lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
        .text("CRAFTED WITH BRILLIANCE", MARGIN_X, 50, { lineBreak: false });

      const rightX = PAGE_WIDTH - MARGIN_X - 240;
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11)
        .text("Gemone Diamond Collection", rightX, 26, { width: 240, align: "right", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
        .text(`Page ${pageNum} of ${totalPages}`, rightX, 45, { width: 240, align: "right", lineBreak: false });

      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MARGIN_X, HEADER_H - 4).lineTo(PAGE_WIDTH - MARGIN_X, HEADER_H - 4).stroke();
    };

    const drawFooter = () => {
      const footerY = PAGE_HEIGHT - FOOTER_H + 12;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MARGIN_X, footerY - 10).lineTo(PAGE_WIDTH - MARGIN_X, footerY - 10).stroke();
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
        .text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", MARGIN_X, footerY, { lineBreak: false });
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
        .text(MONTH_YEAR, MARGIN_X, footerY, { width: CONTENT_WIDTH, align: "right", lineBreak: false });
    };

    const drawGridLines = () => {
      const midX = MARGIN_X + COL_W;
      const midY = HEADER_H + ROW_H;
      // Vertical divider
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(midX, HEADER_H).lineTo(midX, HEADER_H + BODY_H).stroke();
      // Horizontal divider
      doc.strokeColor(RULE_COLOR).lineWidth(0.5)
        .moveTo(MARGIN_X, midY).lineTo(PAGE_WIDTH - MARGIN_X, midY).stroke();
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

      // Title
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(12)
        .text(item.title, innerX, y, { width: innerW, lineBreak: false, ellipsis: true });
      y += 17;

      // Subtitle
      const totalDiamond = item.centerDiamondWeight + item.sideDiamondWeight;
      const subLabel = totalDiamond > 0 ? "LAB GROWN DIAMOND" : "FINE JEWELLERY";
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8)
        .text(subLabel, innerX, y, { lineBreak: false });
      y += 14;

      doc.strokeColor(RULE_COLOR).lineWidth(0.3)
        .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 8;

      // Image area — generous height
      const availableH = ROW_H - CELL_PAD * 2;
      const imgH = Math.round(availableH * 0.42);
      const imgW = innerW;

      if (item.imageBase64 && item.imageBase64.length > 0) {
        try {
          const imgBuf = Buffer.from(item.imageBase64, "base64");
          // Determine image type from mimeType
          const imgType = (item.imageMimeType || "image/jpeg").includes("png") ? "png" : "jpeg";
          doc.image(imgBuf, innerX, y, { fit: [imgW, imgH], align: "center", valign: "center" });
        } catch (imgErr) {
          console.error("PDF image render error:", imgErr);
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

      // Details
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

      // Itemized charges
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
        doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7.5)
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
        { x: MARGIN_X, y: HEADER_H },
        { x: MARGIN_X + COL_W, y: HEADER_H },
        { x: MARGIN_X, y: HEADER_H + ROW_H },
        { x: MARGIN_X + COL_W, y: HEADER_H + ROW_H },
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
