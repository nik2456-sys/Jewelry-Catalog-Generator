import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
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
  imageLeft?: string;
  imageCenter?: string;
  imageRight?: string;
}

interface PricingConfig {
  goldPriceUSD: number;
  diamondPriceUSD: number;
  labourPerGramUSD: number;
  wastagePerGramUSD: number;
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
    const wastageUSD = config.wastagePerGramUSD * weight;
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

// Fetch an image from a CDN URL into a Buffer
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const ab = await response.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

// ─── Sample Excel ─────────────────────────────────────────────────────────────
router.get("/sample", (_req, res) => {
  const headers = [
    "Sr No", "Title",
    "10K Weight", "14K Weight", "18K Weight",
    "Center Diamond Weight", "Side Diamond Weight",
    "Image 1 (Left)", "Image 2 (Center)", "Image 3 (Right)",
  ];
  const sampleRows = [
    [1, "Solitaire Diamond Ring", 2.500, 2.750, 3.000, 0.50, 0.25,
      "https://example.com/ring-left.jpg", "https://example.com/ring-center.jpg", "https://example.com/ring-right.jpg"],
    [2, "Diamond Stud Earrings", 1.800, 2.000, 2.200, 0.30, 0.10,
      "https://example.com/earring-left.jpg", "https://example.com/earring-center.jpg", "https://example.com/earring-right.jpg"],
    [3, "Tennis Bracelet", 5.200, 5.800, 6.500, 1.20, 0.60,
      "https://example.com/bracelet-left.jpg", "https://example.com/bracelet-center.jpg", "https://example.com/bracelet-right.jpg"],
    [4, "Diamond Pendant Necklace", 1.200, 1.350, 1.500, 0.40, 0.15, "", "", ""],
    [5, "Eternity Band Ring", 3.100, 3.450, 3.800, 0.00, 0.80, "", "", ""],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
  ws["!cols"] = [
    { wch: 8 }, { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 22 }, { wch: 20 }, { wch: 35 }, { wch: 35 }, { wch: 35 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Jewelry Catalog");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="gemone-catalog-sample.xlsx"');
  res.send(buf);
});

// ─── Upload ───────────────────────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, raw: false });

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
    const imgLeftCol = findCol(["image 1", "img 1", "left"]);
    const imgCenterCol = findCol(["image 2", "img 2", "center image", "main"]);
    const imgRightCol = findCol(["image 3", "img 3", "right"]);

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

      const getStr = (idx: number): string | undefined => {
        if (idx < 0 || idx >= row.length) return undefined;
        const v = String(row[idx] || "").trim();
        return v.length > 0 ? v : undefined;
      };

      const srNo = srNoCol >= 0 ? parseInt(String(row[srNoCol])) || i : i;
      const title = titleCol >= 0 ? String(row[titleCol] || `Item ${srNo}`) : `Item ${srNo}`;
      if (!title || title.trim() === "") continue;

      items.push({
        srNo, title,
        weight10k: parseNum(w10kCol),
        weight14k: parseNum(w14kCol),
        weight18k: parseNum(w18kCol),
        centerDiamondWeight: parseNum(centerCol),
        sideDiamondWeight: parseNum(sideCol),
        imageLeft: getStr(imgLeftCol),
        imageCenter: getStr(imgCenterCol),
        imageRight: getStr(imgRightCol),
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

    // Pre-fetch all CDN images
    const allUrls = new Set<string>();
    for (const item of items) {
      if (item.imageLeft) allUrls.add(item.imageLeft);
      if (item.imageCenter) allUrls.add(item.imageCenter);
      if (item.imageRight) allUrls.add(item.imageRight);
    }
    const fetchedImages = new Map<string, Buffer>();
    await Promise.all(
      Array.from(allUrls).map(async (url) => {
        const buf = await fetchImageBuffer(url);
        if (buf) fetchedImages.set(url, buf);
      })
    );

    const DIAMOND_COLOR = "EF";
    const DIAMOND_CLARITY = "VS Clarity";
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
    const CELL_PAD = 24;

    const doc = new PDFDocument({
      size: [PAGE_W, PAGE_H],
      margin: 0,
      autoFirstPage: false,
      info: { Title: `Gemone Diamond ${catalogType} Catalog`, Author: "Gemone Diamond" },
    });

    doc.registerFont("Playfair", PLAYFAIR_FONT);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gemone-diamond-${catalogType.toLowerCase()}-catalog.pdf"`);
    doc.pipe(res);

    const totalPages = Math.ceil(items.length / 4);

    // ══ COVER PAGE ═══════════════════════════════════════════════════════════
    doc.addPage();

    const cx = PAGE_W / 2;

    // Top rule pair
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, 60).lineTo(PAGE_W - MX, 60).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 64).lineTo(PAGE_W - MX, 64).stroke();

    // ── Brand name block ──────────────────────────────────────────────────────
    doc.fillColor(GOLD).font("Playfair").fontSize(72)
      .text("GEMONE", 0, 100, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 12 });

    doc.fillColor(BLACK).font("Playfair").fontSize(52)
      .text("DIAMOND", 0, 182, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 8 });

    // Rule + dot
    doc.strokeColor(GOLD).lineWidth(0.8)
      .moveTo(cx - 100, 252).lineTo(cx + 100, 252).stroke();
    doc.fillColor(GOLD).circle(cx, 252, 3).fill();

    // Slogan "ETERNAL LUXURY"
    doc.fillColor(GOLD_LIGHT).font("Playfair").fontSize(14)
      .text("ETERNAL LUXURY", 0, 268, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 3 });

    // Thin divider
    doc.strokeColor(RULE_COLOR).lineWidth(0.4)
      .moveTo(MX + 60, 296).lineTo(PAGE_W - MX - 60, 296).stroke();

    // Catalog type badge
    const badgeLabel = catalogType === "B2B" ? "B2B WHOLESALE COLLECTION" : "B2C RETAIL COLLECTION";
    doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11)
      .text(badgeLabel, 0, 312, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 4 });

    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
      .text(
        `${items.length} PIECES  ·  ALL KARATS  ·  EF COLOR  ·  VS CLARITY`,
        0, 332, { width: PAGE_W, align: "center", lineBreak: false }
      );

    // Triple rule
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 360).lineTo(PAGE_W - MX, 360).stroke();
    doc.strokeColor(GOLD).lineWidth(1.0).moveTo(MX, 363).lineTo(PAGE_W - MX, 363).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 366).lineTo(PAGE_W - MX, 366).stroke();

    // Karat row
    const karatY = 396;
    const karatCols = [
      { k: "10K", x: cx - 240 },
      { k: "14K", x: cx - 40 },
      { k: "18K", x: cx + 160 },
    ];
    for (const col of karatCols) {
      doc.fillColor(GOLD).font("Playfair").fontSize(22)
        .text(col.k, col.x, karatY, { width: 80, align: "center", lineBreak: false });
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
        .text("GOLD", col.x, karatY + 28, { width: 80, align: "center", lineBreak: false });
    }
    doc.strokeColor(RULE_COLOR).lineWidth(0.5)
      .moveTo(cx - 80, karatY - 6).lineTo(cx - 80, karatY + 44).stroke();
    doc.strokeColor(RULE_COLOR).lineWidth(0.5)
      .moveTo(cx + 120, karatY - 6).lineTo(cx + 120, karatY + 44).stroke();

    // Triple rule below karats
    const afterKaratY = 462;
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, afterKaratY).lineTo(PAGE_W - MX, afterKaratY).stroke();
    doc.strokeColor(GOLD).lineWidth(1.0).moveTo(MX, afterKaratY + 3).lineTo(PAGE_W - MX, afterKaratY + 3).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, afterKaratY + 6).lineTo(PAGE_W - MX, afterKaratY + 6).stroke();

    // ── Core Values section ────────────────────────────────────────────────────
    // 4 value pillars with drawn icons
    const valuesY = 492;
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7.5)
      .text("O U R   C O R E   V A L U E S", 0, valuesY, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 });

    const iconY = valuesY + 28;
    const iconR = 44;  // icon circle radius
    // 4 icons evenly spaced
    const iconXs = [cx - 340, cx - 113, cx + 113, cx + 340];
    const iconLabelW = 140;

    // Helper: draw icon circle background
    const iconCircle = (x: number, y: number) => {
      doc.circle(x, y, iconR).strokeColor(GOLD).lineWidth(0.8).stroke();
    };

    // Icon 1: Globe (worldwide shipping)
    iconCircle(iconXs[0], iconY + iconR);
    // Globe: outer circle already drawn; add horizontal ellipse + vertical line
    doc.ellipse(iconXs[0], iconY + iconR, iconR * 0.6, iconR * 0.22).strokeColor(GOLD_LIGHT).lineWidth(0.6).stroke();
    doc.moveTo(iconXs[0], iconY + iconR - iconR * 0.85).lineTo(iconXs[0], iconY + iconR + iconR * 0.85)
      .strokeColor(GOLD_LIGHT).lineWidth(0.6).stroke();
    doc.moveTo(iconXs[0] - iconR * 0.85, iconY + iconR).lineTo(iconXs[0] + iconR * 0.85, iconY + iconR)
      .strokeColor(GOLD_LIGHT).lineWidth(0.6).stroke();

    // Icon 2: Star (satisfied clients)
    iconCircle(iconXs[1], iconY + iconR);
    const starCx = iconXs[1];
    const starCy = iconY + iconR;
    const outerR = 22;
    const innerR = 10;
    const starPath: number[][] = [];
    for (let si = 0; si < 10; si++) {
      const angle = (si * Math.PI) / 5 - Math.PI / 2;
      const r = si % 2 === 0 ? outerR : innerR;
      starPath.push([starCx + r * Math.cos(angle), starCy + r * Math.sin(angle)]);
    }
    doc.moveTo(starPath[0][0], starPath[0][1]);
    for (let si = 1; si < starPath.length; si++) doc.lineTo(starPath[si][0], starPath[si][1]);
    doc.closePath().fillColor(GOLD_LIGHT).fill();

    // Icon 3: Diamond (50+ years)
    iconCircle(iconXs[2], iconY + iconR);
    const gemCx = iconXs[2];
    const gemCy = iconY + iconR;
    doc.moveTo(gemCx, gemCy - 26)
      .lineTo(gemCx + 26, gemCy)
      .lineTo(gemCx, gemCy + 26)
      .lineTo(gemCx - 26, gemCy)
      .closePath().fillColor(GOLD_LIGHT).fill();

    // Icon 4: Shield with checkmark (promise)
    iconCircle(iconXs[3], iconY + iconR);
    const shCx = iconXs[3];
    const shCy = iconY + iconR - 2;
    const shW = 28; const shH = 34;
    // Shield: top rect + bottom point
    doc.moveTo(shCx - shW, shCy - shH / 2)
      .lineTo(shCx + shW, shCy - shH / 2)
      .lineTo(shCx + shW, shCy + 4)
      .lineTo(shCx, shCy + shH / 2 + 4)
      .lineTo(shCx - shW, shCy + 4)
      .closePath().strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke();
    // Checkmark inside shield
    doc.moveTo(shCx - 12, shCy + 2)
      .lineTo(shCx - 3, shCy + 11)
      .lineTo(shCx + 14, shCy - 11)
      .strokeColor(GOLD).lineWidth(2.5).stroke();

    // Labels below icons
    const labelY = iconY + iconR * 2 + 10;
    const valueLines = [
      ["Worldwide", "Shipping"],
      ["20,000+", "Happy Clients"],
      ["50+ Years", "Experience"],
      ["Our Promise", "Auth · Commit · Quality"],
    ];

    iconXs.forEach((ix, vi) => {
      const lx = ix - iconLabelW / 2;
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11)
        .text(valueLines[vi][0], lx, labelY, { width: iconLabelW, align: "center", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
        .text(valueLines[vi][1], lx, labelY + 16, { width: iconLabelW, align: "center", lineBreak: false });
    });

    // ── Bottom rules + footer ─────────────────────────────────────────────────
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, PAGE_H - 80).lineTo(PAGE_W - MX, PAGE_H - 80).stroke();
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, PAGE_H - 76).lineTo(PAGE_W - MX, PAGE_H - 76).stroke();

    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
      .text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", 0, PAGE_H - 60, { width: PAGE_W, align: "center", lineBreak: false });
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7.5)
      .text(MONTH_YEAR, 0, PAGE_H - 44, { width: PAGE_W, align: "center", lineBreak: false });

    // ══ CATALOG PAGES ═════════════════════════════════════════════════════════
    const drawHeader = (pageNum: number) => {
      doc.fillColor(BLACK).font("Playfair").fontSize(17)
        .text("Gemone Diamond", MX, 24, { lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5)
        .text("ETERNAL LUXURY", MX, 48, { lineBreak: false });

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

    // Helper to safely render one image
    const renderImage = (buf: Buffer, x: number, y: number, w: number, h: number) => {
      try {
        doc.image(buf, x, y, { fit: [w, h], align: "center", valign: "center" });
      } catch {
        doc.rect(x, y, w, h).fillColor(LIGHT_BG).fill();
        doc.rect(x, y, w, h).strokeColor(RULE_COLOR).lineWidth(0.3).stroke();
      }
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

      // ── SKU (left) + Serial number (right) on same row ────────────────────
      const skuLabel = `GD-${String(item.srNo).padStart(3, "0")}`;
      const srLabel = `#${String(item.srNo).padStart(3, "0")}`;
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(8)
        .text(skuLabel, innerX, y, { lineBreak: false });
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(8)
        .text(srLabel, innerX, y, { width: innerW, align: "right", lineBreak: false });
      y += 16;

      // ── Title (2-line max, wraps naturally) ───────────────────────────────
      const totalDiamond = item.centerDiamondWeight + item.sideDiamondWeight;
      doc.fillColor(BLACK).font("Playfair").fontSize(11)
        .text(item.title, innerX, y, { width: innerW, lineBreak: true, height: 30, ellipsis: true });
      y += 34;

      // ── Subtitle ──────────────────────────────────────────────────────────
      const subLabel = totalDiamond > 0 ? "LAB GROWN DIAMOND" : "FINE JEWELLERY";
      doc.fillColor(GOLD_LIGHT).font("Helvetica").fontSize(7.5)
        .text(subLabel, innerX, y, { lineBreak: false });
      y += 14;

      doc.strokeColor(RULE_COLOR).lineWidth(0.3)
        .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 8;

      // ── Three images in a row ──────────────────────────────────────────────
      const imgGap = 6;
      const imgW = Math.floor((innerW - imgGap * 2) / 3);
      const imgH = 150;

      const imgSlots = [
        { url: item.imageLeft, label: "Left" },
        { url: item.imageCenter, label: "Center" },
        { url: item.imageRight, label: "Right" },
      ];

      imgSlots.forEach((slot, idx) => {
        const ix = innerX + idx * (imgW + imgGap);
        const buf = slot.url ? fetchedImages.get(slot.url) : undefined;
        if (buf) {
          renderImage(buf, ix, y, imgW, imgH);
        } else {
          doc.rect(ix, y, imgW, imgH).fillColor(LIGHT_BG).fill();
          doc.rect(ix, y, imgW, imgH).strokeColor(RULE_COLOR).lineWidth(0.3).stroke();
          doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(6.5)
            .text(slot.label, ix, y + imgH / 2 - 4, { width: imgW, align: "center", lineBreak: false });
        }
      });
      y += imgH + 9;

      // ── Details ───────────────────────────────────────────────────────────
      const detailLabelW = innerW * 0.52;
      const detailValW = innerW * 0.48;

      const detailRow = (label: string, value: string) => {
        doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7.5)
          .text(label, innerX, y, { width: detailLabelW, lineBreak: false });
        doc.fillColor(DARK_GRAY).font("Helvetica-Bold").fontSize(7.5)
          .text(value, innerX + detailLabelW, y, { width: detailValW, align: "right", lineBreak: false });
        y += 11;
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
      y += 6;

      // ── Itemized charges ──────────────────────────────────────────────────
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

        y += 3;
        doc.strokeColor(RULE_COLOR).lineWidth(0.3)
          .moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
        y += 6;
      }

      // ── Karat price strip ─────────────────────────────────────────────────
      const karats: KaratKey[] = ["10K", "14K", "18K"];
      const karatW = innerW / 3;

      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatW;
        doc.fillColor(GOLD_LIGHT).font("Helvetica").fontSize(7)
          .text(k + " Gold", kx, y, { width: karatW, align: "center", lineBreak: false });
      });
      y += 12;

      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatW;
        doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(9.5)
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

    // ══ THANK YOU PAGE ════════════════════════════════════════════════════════
    doc.addPage();

    // Top rules
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, 60).lineTo(PAGE_W - MX, 60).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 64).lineTo(PAGE_W - MX, 64).stroke();

    // Small dot ornament
    [cx - 12, cx, cx + 12].forEach((dx) => {
      doc.fillColor(GOLD).circle(dx, 100, 3).fill();
    });

    // "Thank You" heading
    doc.fillColor(GOLD).font("Playfair").fontSize(62)
      .text("Thank You", 0, 124, { width: PAGE_W, align: "center", lineBreak: false });

    doc.fillColor(BLACK).font("Playfair").fontSize(18)
      .text("for visiting our catalog", 0, 202, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 });

    // Thin rule + dot
    doc.strokeColor(GOLD).lineWidth(0.8)
      .moveTo(cx - 100, 238).lineTo(cx + 100, 238).stroke();
    doc.fillColor(GOLD).circle(cx, 238, 3).fill();

    // Tagline
    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(10)
      .text(
        "We look forward to crafting your next masterpiece.",
        0, 256, { width: PAGE_W, align: "center", lineBreak: false }
      );

    // Contact Us section
    doc.strokeColor(RULE_COLOR).lineWidth(0.4)
      .moveTo(MX + 60, 300).lineTo(PAGE_W - MX - 60, 300).stroke();

    doc.fillColor(GOLD).font("Playfair").fontSize(16)
      .text("Contact Us", 0, 318, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 });

    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
      .text("Our team is always ready to assist you", 0, 342, { width: PAGE_W, align: "center", lineBreak: false });

    // Phone numbers — side by side
    const phoneY = 376;
    const phoneBoxW = 200;
    const phoneBoxH = 54;
    const phone1X = cx - phoneBoxW - 20;
    const phone2X = cx + 20;

    const drawPhoneBox = (x: number, y: number, number: string, label: string) => {
      doc.rect(x, y, phoneBoxW, phoneBoxH).strokeColor(GOLD_LIGHT).lineWidth(0.6).stroke();
      doc.fillColor(GOLD_LIGHT).font("Helvetica").fontSize(7)
        .text(label, x, y + 8, { width: phoneBoxW, align: "center", lineBreak: false });
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(13)
        .text(number, x, y + 22, { width: phoneBoxW, align: "center", lineBreak: false });
    };

    drawPhoneBox(phone1X, phoneY, "+91 63513 49740", "SALES & ENQUIRY");
    drawPhoneBox(phone2X, phoneY, "+91 93755 20003", "SUPPORT");

    // Core values brief line
    doc.strokeColor(RULE_COLOR).lineWidth(0.4)
      .moveTo(MX + 60, 468).lineTo(PAGE_W - MX - 60, 468).stroke();

    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
      .text(
        "Authenticity  ·  Commitment  ·  Quality",
        0, 484, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 }
      );

    // Bottom rule + footer
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, PAGE_H - 80).lineTo(PAGE_W - MX, PAGE_H - 80).stroke();
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, PAGE_H - 76).lineTo(PAGE_W - MX, PAGE_H - 76).stroke();

    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
      .text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", 0, PAGE_H - 60, { width: PAGE_W, align: "center", lineBreak: false });
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7.5)
      .text(MONTH_YEAR, 0, PAGE_H - 44, { width: PAGE_W, align: "center", lineBreak: false });

    doc.end();
  } catch (err) {
    console.error("Generate error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate catalog" });
  }
});

export default router;
