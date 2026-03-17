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
  goldPriceINR: number;
  diamondPriceUSD: number;
  usdToInrRate: number;
  labourPerGram: number;
  wastageFixed: number;
  handlingPercent: number;
  profitPercent: number;
  adminChargePercent: number;
}

interface GenerateCatalogRequest {
  items: JewelryItem[];
  pricingConfig: PricingConfig;
  catalogType: "B2B" | "B2C";
  showItemizedCharges: boolean;
  karat: "10K" | "14K" | "18K";
}

function getKaratFactor(karat: string): number {
  if (karat === "10K") return 0.45;
  if (karat === "14K") return 0.65;
  if (karat === "18K") return 0.75;
  return 0.65;
}

function getWeightForKarat(item: JewelryItem, karat: string): number {
  if (karat === "10K") return item.weight10k;
  if (karat === "14K") return item.weight14k;
  if (karat === "18K") return item.weight18k;
  return item.weight14k;
}

function calcPrices(item: JewelryItem, config: PricingConfig, karat: string, catalogType: "B2B" | "B2C") {
  const factor = getKaratFactor(karat);
  const weight = getWeightForKarat(item, karat);

  const metalCalcINR = (factor * config.goldPriceINR * weight) / 75;
  const metalCalcUSD = metalCalcINR / config.usdToInrRate;

  const centerDiamondUSD = item.centerDiamondWeight * config.diamondPriceUSD;
  const sideDiamondUSD = item.sideDiamondWeight * config.diamondPriceUSD;

  const labourINR = config.labourPerGram * weight;
  const labourUSD = labourINR / config.usdToInrRate;

  if (catalogType === "B2B") {
    const wastageUSD = config.wastageFixed / config.usdToInrRate;
    const subtotal = metalCalcUSD + centerDiamondUSD + sideDiamondUSD + labourUSD;
    const handlingUSD = subtotal * (config.handlingPercent / 100);
    const adminUSD = subtotal * (config.adminChargePercent / 100);
    const total = subtotal + wastageUSD + handlingUSD + adminUSD;

    return {
      metalCalcUSD,
      centerDiamondUSD,
      sideDiamondUSD,
      labourUSD,
      wastageUSD,
      handlingUSD,
      adminUSD,
      profitUSD: 0,
      total,
    };
  } else {
    const diamondCalcUSD = centerDiamondUSD + sideDiamondUSD;
    const subtotal = metalCalcUSD + diamondCalcUSD + labourUSD;
    const handlingUSD = subtotal * (config.handlingPercent / 100);
    const profitUSD = (subtotal + handlingUSD) * (config.profitPercent / 100);
    const total = subtotal + handlingUSD + profitUSD;

    return {
      metalCalcUSD,
      centerDiamondUSD,
      sideDiamondUSD,
      diamondCalcUSD,
      labourUSD,
      wastageUSD: 0,
      handlingUSD,
      adminUSD: 0,
      profitUSD,
      total,
    };
  }
}

function fmt(v: number): string {
  return `$${v.toFixed(2)}`;
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
    const { items, pricingConfig, catalogType, showItemizedCharges, karat } = body;

    if (!items || !pricingConfig || !catalogType || !karat) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: {
        Title: `Gemone Diamond - ${catalogType} Catalog - ${karat}`,
        Author: "Gemone Diamond",
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gemone-diamond-${catalogType.toLowerCase()}-${karat}-catalog.pdf"`);

    doc.pipe(res);

    const PAGE_WIDTH = 595.28;
    const PAGE_HEIGHT = 841.89;
    const MARGIN = 40;
    const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
    const ITEMS_PER_ROW = 2;
    const ITEMS_PER_PAGE = 4;

    const GOLD_COLOR = "#B8960C";
    const DARK_COLOR = "#1A1A1A";
    const LIGHT_GRAY = "#F8F6F0";
    const BORDER_COLOR = "#D4AF37";
    const TEXT_GRAY = "#555555";

    const registerFonts = () => {
      try {
        doc.font("Helvetica");
      } catch (_e) {
        // fallback
      }
    };

    registerFonts();

    const drawPageHeader = () => {
      doc.rect(0, 0, PAGE_WIDTH, 70).fill(DARK_COLOR);
      doc.fillColor("#D4AF37").fontSize(22).font("Helvetica-Bold").text("GEMONE DIAMOND", MARGIN, 18, { align: "center", width: CONTENT_WIDTH });
      doc.fillColor("#C0A060").fontSize(9).font("Helvetica").text(`${catalogType} CATALOG  •  ${karat} GOLD  •  PROFESSIONAL PRICING`, MARGIN, 44, { align: "center", width: CONTENT_WIDTH });
      doc.moveDown(0);
    };

    const drawPageFooter = (pageNum: number, totalPages: number) => {
      const footerY = PAGE_HEIGHT - 35;
      doc.rect(0, footerY - 5, PAGE_WIDTH, 40).fill(DARK_COLOR);
      doc.fillColor("#888888").fontSize(7).font("Helvetica").text(
        `© Gemone Diamond  •  Page ${pageNum} of ${totalPages}  •  All prices in USD  •  ${catalogType} Catalog  •  ${karat} Gold`,
        MARGIN,
        footerY + 3,
        { align: "center", width: CONTENT_WIDTH }
      );
    };

    const drawDivider = (y: number) => {
      doc.save();
      doc.strokeColor(BORDER_COLOR).lineWidth(0.5).moveTo(MARGIN, y).lineTo(PAGE_WIDTH - MARGIN, y).stroke();
      doc.restore();
    };

    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    let pageNum = 0;
    let isFirstPage = true;

    for (let i = 0; i < items.length; i += ITEMS_PER_PAGE) {
      if (!isFirstPage) {
        doc.addPage();
      }
      isFirstPage = false;
      pageNum++;

      const pageItems = items.slice(i, i + ITEMS_PER_PAGE);
      const HEADER_HEIGHT = 70;
      const FOOTER_HEIGHT = 35;
      const AVAILABLE_HEIGHT = PAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - 20;

      const rowCount = Math.ceil(pageItems.length / ITEMS_PER_ROW);
      const CELL_HEIGHT = AVAILABLE_HEIGHT / Math.max(rowCount, 1);
      const CELL_WIDTH = CONTENT_WIDTH / ITEMS_PER_ROW;

      drawPageHeader();
      drawPageFooter(pageNum, totalPages);

      for (let j = 0; j < pageItems.length; j++) {
        const item = pageItems[j];
        const col = j % ITEMS_PER_ROW;
        const row = Math.floor(j / ITEMS_PER_ROW);

        const cellX = MARGIN + col * CELL_WIDTH;
        const cellY = HEADER_HEIGHT + 10 + row * CELL_HEIGHT;
        const cellPad = 8;

        doc.save();
        doc.rect(cellX + 4, cellY + 4, CELL_WIDTH - 8, CELL_HEIGHT - 10).fillColor(LIGHT_GRAY).fill();
        doc.rect(cellX + 4, cellY + 4, CELL_WIDTH - 8, CELL_HEIGHT - 10).strokeColor(BORDER_COLOR).lineWidth(0.75).stroke();
        doc.restore();

        const innerX = cellX + cellPad + 4;
        const innerWidth = CELL_WIDTH - cellPad * 2 - 8;

        const titleBarHeight = 22;
        doc.rect(cellX + 4, cellY + 4, CELL_WIDTH - 8, titleBarHeight).fill(DARK_COLOR);

        const titleText = `#${item.srNo} – ${item.title}`;
        doc.fillColor(GOLD_COLOR).fontSize(8).font("Helvetica-Bold").text(titleText, innerX, cellY + 10, {
          width: innerWidth,
          ellipsis: true,
          lineBreak: false,
        });

        let contentY = cellY + 4 + titleBarHeight + 6;

        const IMG_MAX_H = CELL_HEIGHT * 0.4;
        const IMG_MAX_W = innerWidth;

        if (item.imageBase64) {
          try {
            const imgBuf = Buffer.from(item.imageBase64, "base64");
            const imgMime = item.imageMimeType || "image/jpeg";
            const imgType = imgMime.includes("png") ? "png" : "jpeg";

            doc.image(imgBuf, innerX, contentY, {
              fit: [IMG_MAX_W, IMG_MAX_H],
              align: "center",
              valign: "center",
            });
            contentY += IMG_MAX_H + 6;
          } catch (_e) {
            doc.fillColor(TEXT_GRAY).fontSize(7).text("[Image unavailable]", innerX, contentY, { width: innerWidth });
            contentY += 14;
          }
        } else {
          doc.rect(innerX, contentY, IMG_MAX_W, IMG_MAX_H * 0.5).fillColor("#E8E0D0").fill();
          doc.fillColor(TEXT_GRAY).fontSize(7).text("No Image", innerX, contentY + IMG_MAX_H * 0.25 - 5, { width: IMG_MAX_W, align: "center" });
          contentY += IMG_MAX_H * 0.5 + 6;
        }

        drawDivider(contentY);
        contentY += 4;

        const prices = calcPrices(item, pricingConfig, karat, catalogType);
        const lineH = 11;
        const labelW = innerWidth * 0.62;
        const valW = innerWidth * 0.38;

        const printRow = (label: string, value: string, bold = false) => {
          if (contentY + lineH > cellY + CELL_HEIGHT - 12) return;
          const font = bold ? "Helvetica-Bold" : "Helvetica";
          doc.fillColor(TEXT_GRAY).fontSize(7).font(font).text(label, innerX, contentY, { width: labelW, lineBreak: false });
          doc.fillColor(bold ? DARK_COLOR : TEXT_GRAY).fontSize(7).font("Helvetica-Bold").text(value, innerX + labelW, contentY, { width: valW, align: "right", lineBreak: false });
          contentY += lineH;
        };

        doc.font("Helvetica").fontSize(7);

        const weightForKarat = getWeightForKarat(item, karat);
        printRow("Metal Weight:", `${weightForKarat.toFixed(3)}g`);
        printRow("Center Diamond:", `${item.centerDiamondWeight.toFixed(3)} ct`);
        printRow("Side Diamond:", `${item.sideDiamondWeight.toFixed(3)} ct`);

        if (contentY + 4 < cellY + CELL_HEIGHT - 20) {
          drawDivider(contentY + 2);
          contentY += 6;
        }

        if (showItemizedCharges) {
          printRow("Metal Calculation:", fmt(prices.metalCalcUSD));
          if (catalogType === "B2C") {
            printRow("Diamond Calculation:", fmt((prices.centerDiamondUSD || 0) + (prices.sideDiamondUSD || 0)));
          } else {
            printRow("Center Diamond:", fmt(prices.centerDiamondUSD));
            printRow("Side Diamond:", fmt(prices.sideDiamondUSD));
          }
          printRow("Labour:", fmt(prices.labourUSD));
          if (catalogType === "B2B" && prices.wastageUSD > 0) {
            printRow("Wastage:", fmt(prices.wastageUSD));
          }
          printRow(`Handling (${pricingConfig.handlingPercent}%):`, fmt(prices.handlingUSD));
          if (catalogType === "B2C") {
            printRow(`Profit (${pricingConfig.profitPercent}%):`, fmt(prices.profitUSD));
          }
          if (catalogType === "B2B" && pricingConfig.adminChargePercent > 0) {
            printRow(`Admin (${pricingConfig.adminChargePercent}%):`, fmt(prices.adminUSD));
          }
        }

        if (contentY + 4 < cellY + CELL_HEIGHT - 16) {
          drawDivider(contentY + 2);
          contentY += 6;
        }

        const totalY = cellY + CELL_HEIGHT - 16;
        if (totalY > contentY) {
          doc.rect(innerX - 2, totalY - 2, innerWidth + 4, 14).fill(DARK_COLOR);
          doc.fillColor(GOLD_COLOR).fontSize(8).font("Helvetica-Bold")
            .text("TOTAL PRICE:", innerX, totalY + 2, { width: labelW, lineBreak: false });
          doc.fillColor(GOLD_COLOR).fontSize(8).font("Helvetica-Bold")
            .text(fmt(prices.total), innerX + labelW, totalY + 2, { width: valW, align: "right", lineBreak: false });
        }
      }
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
