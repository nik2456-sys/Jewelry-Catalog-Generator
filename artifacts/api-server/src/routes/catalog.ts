import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import PDFDocument from "pdfkit";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirnameESM = path.dirname(fileURLToPath(import.meta.url));
const PLAYFAIR_FONT = path.join(__dirnameESM, "../fonts/PlayfairDisplay-Regular.ttf");
const LOGO_PATH = path.join(__dirnameESM, "../assets/logo.png");
const COVER_BG_PATH = path.join(__dirnameESM, "../assets/cover-bg.png");

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

interface JewelryItem {
  srNo: number;
  skuNo: string;
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
  metalCalcUSD: number; centerDiamondUSD: number; sideDiamondUSD: number;
  labourUSD: number; wastageUSD: number; handlingUSD: number;
  adminUSD: number; profitUSD: number; total: number; weight: number;
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

function fmt(v: number): string { return `$${v.toFixed(2)}`; }
function getMonthYear(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch { return null; }
}

// ─── Sample Excel ─────────────────────────────────────────────────────────────
router.get("/sample", (_req, res) => {
  const headers = ["Sr No","SKU No","Title","10K Weight","14K Weight","18K Weight","Center Diamond Weight","Side Diamond Weight","Image 1 (Left)","Image 2 (Center)","Image 3 (Right)"];
  const sampleRows = [
    [1,"GD-001","Solitaire Diamond Ring",2.5,2.75,3.0,0.50,0.25,"https://example.com/ring-left.jpg","https://example.com/ring-center.jpg","https://example.com/ring-right.jpg"],
    [2,"GD-002","Diamond Stud Earrings",1.8,2.0,2.2,0.30,0.10,"","",""],
    [3,"GD-003","Tennis Bracelet",5.2,5.8,6.5,1.20,0.60,"","",""],
  ];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleRows]);
  ws["!cols"] = [{wch:8},{wch:14},{wch:28},{wch:12},{wch:12},{wch:12},{wch:22},{wch:20},{wch:35},{wch:35},{wch:35}];
  XLSX.utils.book_append_sheet(wb, ws, "Jewelry Catalog");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="gemone-catalog-sample.xlsx"');
  res.send(buf);
});

// ─── Upload ───────────────────────────────────────────────────────────────────
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1, raw: false });
    const headerRow = rows[0] as string[];
    const headerMap: Record<string, number> = {};
    if (Array.isArray(headerRow)) headerRow.forEach((h, i) => { headerMap[String(h).toLowerCase().trim()] = i; });
    const findCol = (names: string[]): number => {
      for (const n of names) for (const [key, idx] of Object.entries(headerMap)) if (key.includes(n)) return idx;
      return -1;
    };
    const srNoCol = findCol(["sr no","sr. no","serial","sr"]);
    const skuCol = findCol(["sku no","sku"]);
    const titleCol = findCol(["title","name","product"]);
    const w10kCol = findCol(["10k"]); const w14kCol = findCol(["14k"]); const w18kCol = findCol(["18k"]);
    const centerCol = findCol(["center diamond","center"]);
    const sideCol = findCol(["side diamond","side"]);
    const imgLeftCol = findCol(["image 1","img 1","left"]);
    const imgCenterCol = findCol(["image 2","img 2","center image","main"]);
    const imgRightCol = findCol(["image 3","img 3","right"]);
    const items: JewelryItem[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] as string[];
      if (!row || row.length === 0) continue;
      const parseNum = (idx: number) => { if (idx < 0 || idx >= row.length) return 0; const v = row[idx]; if (v === undefined || v === null || v === "") return 0; return parseFloat(String(v).replace(/[^0-9.-]/g,"")) || 0; };
      const getStr = (idx: number): string | undefined => { if (idx < 0 || idx >= row.length) return undefined; const v = String(row[idx] || "").trim(); return v.length > 0 ? v : undefined; };
      const srNo = srNoCol >= 0 ? parseInt(String(row[srNoCol])) || i : i;
      const title = titleCol >= 0 ? String(row[titleCol] || `Item ${srNo}`) : `Item ${srNo}`;
      if (!title || title.trim() === "") continue;
      const skuNo = getStr(skuCol) ?? String(srNo);
      items.push({ srNo, skuNo, title, weight10k: parseNum(w10kCol), weight14k: parseNum(w14kCol), weight18k: parseNum(w18kCol), centerDiamondWeight: parseNum(centerCol), sideDiamondWeight: parseNum(sideCol), imageLeft: getStr(imgLeftCol), imageCenter: getStr(imgCenterCol), imageRight: getStr(imgRightCol) });
    }
    res.json({ items, totalRows: items.length });
  } catch (err) { console.error("Upload error:", err); res.status(500).json({ error: "Failed to parse Excel file" }); }
});

// ─── Generate PDF ─────────────────────────────────────────────────────────────
router.post("/generate", async (req, res) => {
  try {
    const body = req.body as GenerateCatalogRequest;
    const { items, pricingConfig, catalogType, showItemizedCharges } = body;
    if (!items || !pricingConfig || !catalogType) { res.status(400).json({ error: "Missing required fields" }); return; }

    let logoBuf: Buffer | null = null;
    try { logoBuf = fs.readFileSync(LOGO_PATH); } catch { logoBuf = null; }
    let coverBgBuf: Buffer | null = null;
    try { coverBgBuf = fs.readFileSync(COVER_BG_PATH); } catch { coverBgBuf = null; }

    const allUrls = new Set<string>();
    for (const item of items) { if (item.imageLeft) allUrls.add(item.imageLeft); if (item.imageCenter) allUrls.add(item.imageCenter); if (item.imageRight) allUrls.add(item.imageRight); }
    const fetchedImages = new Map<string, Buffer>();
    await Promise.all(Array.from(allUrls).map(async (url) => { const buf = await fetchImageBuffer(url); if (buf) fetchedImages.set(url, buf); }));

    const DIAMOND_COLOR = "EF";
    const DIAMOND_CLARITY = "VS Clarity";
    const MONTH_YEAR = getMonthYear();

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

    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false, info: { Title: `Gemone Diamond ${catalogType} Catalog`, Author: "Gemone Diamond" } });
    doc.registerFont("Playfair", PLAYFAIR_FONT);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="gemone-diamond-${catalogType.toLowerCase()}-catalog.pdf"`);
    doc.pipe(res);

    const totalPages = Math.ceil(items.length / 4);
    const cx = PAGE_W / 2;

    // ── Helper: draw logo square ──────────────────────────────────────────────
    const drawLogo = (x: number, y: number, size: number) => {
      if (!logoBuf) return;
      try { doc.image(logoBuf, x, y, { fit: [size, size], align: "center", valign: "center" }); } catch { /* skip */ }
    };

    // ── Helper: draw icon circle ──────────────────────────────────────────────
    const iconCircle = (x: number, y: number, r: number) => {
      doc.circle(x, y, r).strokeColor(GOLD).lineWidth(0.8).stroke();
    };

    // ── Helper: page bottom rules + footer ────────────────────────────────────
    const drawPageFooter = () => {
      doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, PAGE_H - 80).lineTo(PAGE_W - MX, PAGE_H - 80).stroke();
      doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, PAGE_H - 76).lineTo(PAGE_W - MX, PAGE_H - 76).stroke();
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
        .text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", 0, PAGE_H - 60, { width: PAGE_W, align: "center", lineBreak: false });
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(7.5)
        .text(MONTH_YEAR, 0, PAGE_H - 44, { width: PAGE_W, align: "center", lineBreak: false });
    };

    // ══ COVER PAGE ═══════════════════════════════════════════════════════════
    doc.addPage();

    const DARK_GREEN   = "#1B5E40";
    const COVER_GOLD   = "#C8A84B";
    const SIDEBAR_X    = 808;
    const SIDEBAR_W    = PAGE_W - SIDEBAR_X;
    const MAIN_W       = SIDEBAR_X;
    const mainCx       = MAIN_W / 2;

    // ── Right sidebar ─────────────────────────────────────────────────────────
    doc.rect(SIDEBAR_X, 0, SIDEBAR_W, PAGE_H).fillColor(DARK_GREEN).fill();

    // Repeating diamond tile pattern on sidebar
    const TILE = 40;
    const ps   = 11; // half-size of each diamond
    const patCols = Math.ceil(SIDEBAR_W / TILE) + 1;
    const patRows = Math.ceil(PAGE_H  / TILE) + 2;
    for (let pr = 0; pr < patRows; pr++) {
      for (let pc = 0; pc < patCols; pc++) {
        const ptx = SIDEBAR_X + pc * TILE + (SIDEBAR_W % TILE) / 2;
        const pty = pr * TILE + (pr % 2 === 0 ? 0 : TILE / 2) - TILE / 2;
        doc.moveTo(ptx, pty - ps).lineTo(ptx + ps, pty)
           .lineTo(ptx, pty + ps).lineTo(ptx - ps, pty)
           .closePath().strokeColor(COVER_GOLD).lineWidth(0.55).stroke();
        // Inner cross lines
        doc.moveTo(ptx - ps * 0.45, pty).lineTo(ptx + ps * 0.45, pty)
           .strokeColor(COVER_GOLD).lineWidth(0.3).stroke();
        doc.moveTo(ptx, pty - ps * 0.45).lineTo(ptx, pty + ps * 0.45)
           .strokeColor(COVER_GOLD).lineWidth(0.3).stroke();
      }
    }

    // ── Logo mark ─────────────────────────────────────────────────────────────
    const coverLogoSize = 82;
    const coverLogoY    = 118;
    if (logoBuf) {
      try {
        doc.image(logoBuf, mainCx - coverLogoSize / 2, coverLogoY,
          { fit: [coverLogoSize, coverLogoSize], align: "center", valign: "center" });
      } catch { /* skip */ }
    }

    // ── "GEMONE" brand name ───────────────────────────────────────────────────
    const gemoneY = coverLogoY + coverLogoSize + 22;
    doc.fillColor(DARK_GREEN).font("Helvetica-Bold").fontSize(70)
      .text("GEMONE", 0, gemoneY,
        { width: MAIN_W, align: "center", lineBreak: false, characterSpacing: 10 });

    // ── ". Eternal Luxury ." tagline ──────────────────────────────────────────
    const tagY = gemoneY + 84;
    doc.fillColor(COVER_GOLD).font("Playfair").fontSize(21)
      .text("\u00B7  Eternal Luxury  \u00B7", 0, tagY,
        { width: MAIN_W, align: "center", lineBreak: false });

    // ── "OUR PROMISE" section ─────────────────────────────────────────────────
    const promiseTitleY = 595;
    doc.fillColor(COVER_GOLD).font("Helvetica").fontSize(13)
      .text("O U R   P R O M I S E", 0, promiseTitleY,
        { width: MAIN_W, align: "center", lineBreak: false, characterSpacing: 3 });

    // Thin rule under heading
    doc.strokeColor(COVER_GOLD).lineWidth(0.45)
      .moveTo(MAIN_W * 0.12, promiseTitleY + 22)
      .lineTo(MAIN_W * 0.88, promiseTitleY + 22).stroke();

    // Three promise columns
    const pY = promiseTitleY + 40;
    const pColW = 210;
    const promiseCover = [
      { x: 55,  title: "Authenticity", desc: "Lab-certified Genuine\nDiamonds" },
      { x: 300, title: "Commitment",   desc: "On-time, Every order,\nEvery Time" },
      { x: 545, title: "Quality",      desc: "Flawless, verified by Our\nGemmologists" },
    ];
    promiseCover.forEach(({ x, title, desc }) => {
      doc.fillColor(DARK_GREEN).font("Helvetica-Bold").fontSize(11)
        .text(title, x, pY, { width: pColW, align: "left", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
        .text(desc, x, pY + 18, { width: pColW, align: "left", lineBreak: true });
    });

    // ══ CATALOG PAGES ═════════════════════════════════════════════════════════
    const drawHeader = (pageNum: number) => {
      // Left
      doc.fillColor(BLACK).font("Playfair").fontSize(15).text("Gemone Diamond", MX, 26, { lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8).text("ETERNAL LUXURY", MX, 48, { lineBreak: false });
      // Center logo — square
      const hLogoSize = 44;
      drawLogo(cx - hLogoSize / 2, (HEADER_H - hLogoSize) / 2, hLogoSize);
      // Right
      const rightX = PAGE_W - MX - 240;
      doc.fillColor(GOLD).font("Playfair").fontSize(11).text("Gemone Diamond Collection", rightX, 22, { width: 240, align: "right", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5).text(`Page ${pageNum} of ${totalPages}`, rightX, 42, { width: 240, align: "right", lineBreak: false });
      doc.strokeColor(RULE_COLOR).lineWidth(0.5).moveTo(MX, HEADER_H - 4).lineTo(PAGE_W - MX, HEADER_H - 4).stroke();
    };

    const drawFooter = () => {
      const fy = PAGE_H - FOOTER_H + 12;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5).moveTo(MX, fy - 10).lineTo(PAGE_W - MX, fy - 10).stroke();
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8).text("G E M O N E   D I A M O N D   ·   F I N E   J E W E L L E R Y", MX, fy, { lineBreak: false });
      doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8).text(MONTH_YEAR, MX, fy, { width: CW, align: "right", lineBreak: false });
    };

    const drawGridLines = () => {
      const midX = MX + COL_W;
      const midY = HEADER_H + ROW_H;
      doc.strokeColor(RULE_COLOR).lineWidth(0.5).moveTo(midX, HEADER_H).lineTo(midX, HEADER_H + BODY_H).stroke();
      doc.strokeColor(RULE_COLOR).lineWidth(0.5).moveTo(MX, midY).lineTo(PAGE_W - MX, midY).stroke();
    };

    const renderImage = (buf: Buffer, x: number, y: number, w: number, h: number) => {
      try { doc.image(buf, x, y, { fit: [w, h], align: "center", valign: "center" }); }
      catch { doc.rect(x, y, w, h).fillColor(LIGHT_BG).fill(); doc.rect(x, y, w, h).strokeColor(RULE_COLOR).lineWidth(0.3).stroke(); }
    };

    // topPadding: extra top offset for bottom-row products (more breathing room between rows)
    const drawProduct = (item: JewelryItem, cellX: number, cellY: number, config: PricingConfig, ct: "B2B" | "B2C", showCharges: boolean, topPadding = 0) => {
      const allPrices = calcAllKarats(item, config, ct);
      const innerX = cellX + CELL_PAD;
      const innerW = COL_W - CELL_PAD * 2;
      let y = cellY + CELL_PAD + topPadding;

      // Sr No (left) + SKU No (right)
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9.5)
        .text(`#${String(item.srNo).padStart(3, "0")}`, innerX, y, { lineBreak: false });
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(9.5)
        .text(`SKU - ${item.skuNo}`, innerX, y, { width: innerW, align: "right", lineBreak: false });
      y += 18;

      // Title
      const totalDiamond = item.centerDiamondWeight + item.sideDiamondWeight;
      doc.fillColor(BLACK).font("Playfair").fontSize(11.5)
        .text(item.title, innerX, y, { width: innerW, lineBreak: true, height: 44, ellipsis: true });
      y += 34; // tighter gap between title and subtitle

      // Subtitle
      doc.fillColor(GOLD_LIGHT).font("Helvetica-Bold").fontSize(8)
        .text(totalDiamond > 0 ? "LAB GROWN DIAMOND" : "FINE JEWELLERY", innerX, y, { lineBreak: false });
      y += 16;

      doc.strokeColor(RULE_COLOR).lineWidth(0.3).moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 8;

      // Three images
      const imgGap = 8;
      const imgW = Math.floor((innerW - imgGap * 2) / 3);
      const imgH = showCharges ? 128 : 182;
      [{ url: item.imageLeft, label: "Left" }, { url: item.imageCenter, label: "Center" }, { url: item.imageRight, label: "Right" }].forEach((slot, idx) => {
        const ix = innerX + idx * (imgW + imgGap);
        const buf = slot.url ? fetchedImages.get(slot.url) : undefined;
        if (buf) { renderImage(buf, ix, y, imgW, imgH); }
        else {
          doc.rect(ix, y, imgW, imgH).fillColor(LIGHT_BG).fill();
          doc.rect(ix, y, imgW, imgH).strokeColor(RULE_COLOR).lineWidth(0.3).stroke();
          doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(6.5).text(slot.label, ix, y + imgH / 2 - 4, { width: imgW, align: "center", lineBreak: false });
        }
      });
      y += imgH + 8;

      // Detail rows
      const detailLabelW = innerW * 0.52;
      const detailValW = innerW * 0.48;
      const detailRow = (label: string, value: string) => {
        doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5).text(label, innerX, y, { width: detailLabelW, lineBreak: false });
        doc.fillColor(DARK_GRAY).font("Helvetica-Bold").fontSize(8.5).text(value, innerX + detailLabelW, y, { width: detailValW, align: "right", lineBreak: false });
        y += 13;
      };
      if (item.weight14k > 0) detailRow("Metal Weight", `${item.weight14k.toFixed(3)} g`);
      else if (item.weight10k > 0) detailRow("Metal Weight", `${item.weight10k.toFixed(3)} g`);
      else if (item.weight18k > 0) detailRow("Metal Weight", `${item.weight18k.toFixed(3)} g`);
      if (totalDiamond > 0) detailRow("Diamond", `${totalDiamond.toFixed(2)} ct`);
      detailRow("Color", DIAMOND_COLOR);
      detailRow("Clarity", DIAMOND_CLARITY);
      y += 3;
      doc.strokeColor(RULE_COLOR).lineWidth(0.3).moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
      y += 6;

      // Itemized charges
      if (showCharges) {
        const p14 = allPrices["14K"];
        const chargeRow = (label: string, value: string) => {
          doc.fillColor(MID_GRAY).font("Helvetica").fontSize(7).text(label, innerX, y, { width: detailLabelW, lineBreak: false });
          doc.fillColor(DARK_GRAY).font("Helvetica").fontSize(7).text(value, innerX + detailLabelW, y, { width: detailValW, align: "right", lineBreak: false });
          y += 9;
        };
        chargeRow("Metal (14K)", fmt(p14.metalCalcUSD));
        chargeRow("Diamond", fmt(p14.centerDiamondUSD + p14.sideDiamondUSD));
        chargeRow("Labour", fmt(p14.labourUSD));
        if (ct === "B2B" && p14.wastageUSD > 0) chargeRow("Wastage", fmt(p14.wastageUSD));
        chargeRow(`Handling (${config.handlingPercent}%)`, fmt(p14.handlingUSD));
        if (ct === "B2C") chargeRow(`Profit (${config.profitPercent}%)`, fmt(p14.profitUSD));
        if (ct === "B2B" && config.adminChargePercent > 0) chargeRow(`Admin (${config.adminChargePercent}%)`, fmt(p14.adminUSD));
        y += 3;
        doc.strokeColor(RULE_COLOR).lineWidth(0.3).moveTo(innerX, y).lineTo(innerX + innerW, y).stroke();
        y += 6;
      }

      // Karat price strip
      const karats: KaratKey[] = ["10K", "14K", "18K"];
      const karatW = innerW / 3;
      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatW;
        doc.fillColor(GOLD_LIGHT).font("Helvetica").fontSize(8.5).text(k + " Gold", kx, y, { width: karatW, align: "center", lineBreak: false });
      });
      y += 14;
      karats.forEach((k, idx) => {
        const kx = innerX + idx * karatW;
        doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11).text(fmt(allPrices[k].total), kx, y, { width: karatW, align: "center", lineBreak: false });
      });
    };

    // ── Draw catalog item pages ───────────────────────────────────────────────
    let pageNum = 0;
    for (let i = 0; i < items.length; i += 4) {
      pageNum++;
      doc.addPage();
      drawHeader(pageNum);
      drawFooter();
      drawGridLines();
      const pageItems = items.slice(i, i + 4);
      // Bottom row items get extra top padding (24px) for breathing room between rows
      const positions = [
        { x: MX,         y: HEADER_H,         extra: 0  },
        { x: MX + COL_W, y: HEADER_H,         extra: 0  },
        { x: MX,         y: HEADER_H + ROW_H, extra: 24 },
        { x: MX + COL_W, y: HEADER_H + ROW_H, extra: 24 },
      ];
      pageItems.forEach((item, idx) => {
        drawProduct(item, positions[idx].x, positions[idx].y, pricingConfig, catalogType, showItemizedCharges, positions[idx].extra);
      });
    }

    // ══ WHY BUY FROM US & CUSTOMIZATION — MERGED PAGE ════════════════════════
    doc.addPage();
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, 46).lineTo(PAGE_W - MX, 46).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 50).lineTo(PAGE_W - MX, 50).stroke();

    // Page heading
    drawLogo(cx - 22, 58, 44);
    doc.fillColor(GOLD).font("Playfair").fontSize(32)
      .text("Why Buy From Us & Customization", 0, 110, { width: PAGE_W, align: "center", lineBreak: false });
    doc.strokeColor(GOLD).lineWidth(0.6).moveTo(cx - 150, 150).lineTo(cx + 150, 150).stroke();
    doc.fillColor(GOLD).circle(cx, 150, 2.5).fill();
    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
      .text("Crafted with passion · Your vision, our craftsmanship · Unlimited possibilities", 0, 160, { width: PAGE_W, align: "center", lineBreak: false });

    // ─ Section 1: WHY BUY FROM US ─
    const sec1Y = 184;
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, sec1Y).lineTo(PAGE_W - MX, sec1Y).stroke();
    doc.strokeColor(GOLD).lineWidth(1.0).moveTo(MX, sec1Y + 3).lineTo(PAGE_W - MX, sec1Y + 3).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, sec1Y + 6).lineTo(PAGE_W - MX, sec1Y + 6).stroke();

    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
      .text("W H Y   B U Y   F R O M   U S", 0, sec1Y + 16, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 });

    const w1IconR = 38;
    const w1IconCenterY = sec1Y + 16 + 24 + w1IconR;
    const w1XPositions = [cx - 280, cx, cx + 280];

    // WHY Icon 1: Factory / No Middleman (building icon)
    iconCircle(w1XPositions[0], w1IconCenterY, w1IconR);
    { const bx = w1XPositions[0]; const by = w1IconCenterY;
      // Simple factory: base rect + two squares on top
      doc.rect(bx - 20, by - 6, 40, 18).strokeColor(GOLD_LIGHT).lineWidth(1).stroke();
      doc.rect(bx - 14, by - 22, 10, 16).strokeColor(GOLD_LIGHT).lineWidth(1).stroke();
      doc.rect(bx + 4, by - 22, 10, 16).strokeColor(GOLD_LIGHT).lineWidth(1).stroke();
      // Chimney
      doc.moveTo(bx - 9, by - 28).lineTo(bx - 9, by - 22).strokeColor(GOLD_LIGHT).lineWidth(1).stroke();
      doc.moveTo(bx + 9, by - 28).lineTo(bx + 9, by - 22).strokeColor(GOLD_LIGHT).lineWidth(1).stroke(); }

    // WHY Icon 2: Magnifying glass / QC
    iconCircle(w1XPositions[1], w1IconCenterY, w1IconR);
    { const mx2 = w1XPositions[1]; const my2 = w1IconCenterY - 4;
      doc.circle(mx2 - 4, my2 - 4, 14).strokeColor(GOLD_LIGHT).lineWidth(1.5).stroke();
      doc.moveTo(mx2 + 6, my2 + 6).lineTo(mx2 + 18, my2 + 18).strokeColor(GOLD_LIGHT).lineWidth(2).stroke(); }

    // WHY Icon 3: Custom ring / bespoke
    iconCircle(w1XPositions[2], w1IconCenterY, w1IconR);
    { const rx = w1XPositions[2]; const ry = w1IconCenterY;
      doc.circle(rx, ry, 18).strokeColor(GOLD_LIGHT).lineWidth(2).stroke();
      doc.circle(rx, ry, 10).strokeColor(GOLD).lineWidth(1).stroke();
      // Diamond on top
      doc.moveTo(rx, ry - 28).lineTo(rx + 8, ry - 20).lineTo(rx, ry - 14).lineTo(rx - 8, ry - 20).closePath().fillColor(GOLD_LIGHT).fill(); }

    const w1LabelY = w1IconCenterY + w1IconR + 10;
    const w1Data = [
      { title: "No Middleman", body: "Manufacturing direct\nto end user" },
      { title: "In-House QC", body: "2 Gemmologists inspect\nevery item before shipment" },
      { title: "Custom & Bespoke", body: "Specialized in custom\n& bespoke jewellery" },
    ];
    w1XPositions.forEach((wx, wi) => {
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(11)
        .text(w1Data[wi].title, wx - 70, w1LabelY, { width: 140, align: "center", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8.5)
        .text(w1Data[wi].body, wx - 70, w1LabelY + 17, { width: 140, align: "center", lineBreak: true });
    });

    // ─ Section 2: CUSTOMIZATION ─
    const sec2Y = w1LabelY + 68;
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, sec2Y).lineTo(PAGE_W - MX, sec2Y).stroke();
    doc.strokeColor(GOLD).lineWidth(1.0).moveTo(MX, sec2Y + 3).lineTo(PAGE_W - MX, sec2Y + 3).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, sec2Y + 6).lineTo(PAGE_W - MX, sec2Y + 6).stroke();

    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8)
      .text("C U S T O M I Z A T I O N", 0, sec2Y + 16, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 });

    const c1IconR = 36;
    const c1IconCenterY = sec2Y + 16 + 22 + c1IconR;
    const c1XPositions = [cx - 330, cx - 110, cx + 110, cx + 330];

    // CUSTOM Icon 1: Lightbulb (Your Thought)
    iconCircle(c1XPositions[0], c1IconCenterY, c1IconR);
    { const lbx = c1XPositions[0]; const lby = c1IconCenterY - 2;
      doc.circle(lbx, lby - 4, 12).strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke();
      doc.moveTo(lbx - 6, lby + 8).lineTo(lbx + 6, lby + 8).strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke();
      doc.moveTo(lbx - 4, lby + 12).lineTo(lbx + 4, lby + 12).strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke();
      doc.moveTo(lbx, lby - 20).lineTo(lbx, lby - 24).strokeColor(GOLD_LIGHT).lineWidth(1).stroke();
      doc.moveTo(lbx + 12, lby - 14).lineTo(lbx + 15, lby - 17).strokeColor(GOLD_LIGHT).lineWidth(1).stroke();
      doc.moveTo(lbx - 12, lby - 14).lineTo(lbx - 15, lby - 17).strokeColor(GOLD_LIGHT).lineWidth(1).stroke(); }

    // CUSTOM Icon 2: Star (Any Style)
    iconCircle(c1XPositions[1], c1IconCenterY, c1IconR);
    { const s2Cx = c1XPositions[1]; const s2Cy = c1IconCenterY;
      const s2Path: number[][] = [];
      for (let si = 0; si < 10; si++) { const a = (si * Math.PI) / 5 - Math.PI / 2; const r = si % 2 === 0 ? 20 : 9; s2Path.push([s2Cx + r * Math.cos(a), s2Cy + r * Math.sin(a)]); }
      doc.moveTo(s2Path[0][0], s2Path[0][1]);
      for (let si = 1; si < s2Path.length; si++) doc.lineTo(s2Path[si][0], s2Path[si][1]);
      doc.closePath().strokeColor(GOLD_LIGHT).lineWidth(1).stroke(); }

    // CUSTOM Icon 3: Scissors / Craft (Custom Crafted)
    iconCircle(c1XPositions[2], c1IconCenterY, c1IconR);
    { const scx = c1XPositions[2]; const scy = c1IconCenterY;
      doc.circle(scx - 8, scy + 10, 7).strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke();
      doc.circle(scx + 8, scy + 10, 7).strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke();
      doc.moveTo(scx - 8, scy + 3).lineTo(scx, scy - 14).strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke();
      doc.moveTo(scx + 8, scy + 3).lineTo(scx, scy - 14).strokeColor(GOLD_LIGHT).lineWidth(1.2).stroke(); }

    // CUSTOM Icon 4: Rings (All Metals)
    iconCircle(c1XPositions[3], c1IconCenterY, c1IconR);
    { const rmx = c1XPositions[3]; const rmy = c1IconCenterY;
      doc.circle(rmx - 10, rmy, 14).strokeColor(GOLD_LIGHT).lineWidth(1.5).stroke();
      doc.circle(rmx + 10, rmy, 14).strokeColor(GOLD).lineWidth(1.5).stroke(); }

    const c1LabelY = c1IconCenterY + c1IconR + 10;
    const c1Data = [
      { title: "Your Idea Realised", body: "Any design you\nimagine, we create" },
      { title: "Any Style", body: "Hiphop, Bespoke,\nVintage — any design" },
      { title: "Crafted for You", body: "Any design, any size,\nmade just for you" },
      { title: "All Metals", body: "10K, 14K, 18K Gold,\nPlatinum & Silver" },
    ];
    c1XPositions.forEach((cpx, ci) => {
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(10)
        .text(c1Data[ci].title, cpx - 60, c1LabelY, { width: 120, align: "center", lineBreak: false });
      doc.fillColor(MID_GRAY).font("Helvetica").fontSize(8)
        .text(c1Data[ci].body, cpx - 60, c1LabelY + 15, { width: 120, align: "center", lineBreak: true });
    });

    drawPageFooter();

    // ══ PAYMENT TERMS PAGE ════════════════════════════════════════════════════
    doc.addPage();
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, 60).lineTo(PAGE_W - MX, 60).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 64).lineTo(PAGE_W - MX, 64).stroke();

    drawLogo(cx - 28, 78, 56);

    doc.fillColor(GOLD).font("Playfair").fontSize(38)
      .text("Payment Terms", 0, 146, { width: PAGE_W, align: "center", lineBreak: false });
    doc.strokeColor(GOLD).lineWidth(0.6).moveTo(cx - 140, 194).lineTo(cx + 140, 194).stroke();
    doc.fillColor(GOLD).circle(cx, 194, 3).fill();
    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9.5)
      .text("Transparent. Flexible. Trusted worldwide.", 0, 210, { width: PAGE_W, align: "center", lineBreak: false });

    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 236).lineTo(PAGE_W - MX, 236).stroke();
    doc.strokeColor(GOLD).lineWidth(1.0).moveTo(MX, 239).lineTo(PAGE_W - MX, 239).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 242).lineTo(PAGE_W - MX, 242).stroke();

    const ptX = MX + 40;
    const ptW = CW - 80;
    let ptY = 264;

    const ptSection = (title: string) => {
      doc.fillColor(GOLD).font("Playfair").fontSize(14).text(title, ptX, ptY, { lineBreak: false });
      ptY += 24;
      doc.strokeColor(GOLD_LIGHT).lineWidth(0.3).moveTo(ptX, ptY).lineTo(ptX + ptW, ptY).stroke();
      ptY += 8;
    };

    const ptBullet = (text: string) => {
      doc.fillColor(GOLD_LIGHT).font("Helvetica-Bold").fontSize(10).text("•", ptX, ptY, { lineBreak: false });
      doc.fillColor(DARK_GRAY).font("Helvetica").fontSize(9.5)
        .text(text, ptX + 16, ptY, { width: ptW - 16, lineBreak: true });
      // Consistent spacing: estimate wrapped lines at ~130 chars per line at this width/font
      const estimatedLines = Math.max(1, Math.ceil(text.length / 130));
      ptY += estimatedLines * 13 + 6;
    };

    // Section 1: Payment Methods
    ptSection("Payment Methods");
    ptBullet("We accept payment in INR via our Indian bank account, as well as USD via our US-registered firm bank account — offering you full flexibility.");
    ptBullet("We also accept PayPal (paypal.com) — please note that PayPal transactions carry an additional 10% charge.");
    ptY += 8;

    // Section 2: Handling Time
    ptSection("Handling Time");
    ptBullet("Handling time varies based on total order size and complexity — typically ranging from 3 business days up to 15 business days.");
    ptY += 8;

    // Section 3: Shipping Options
    ptSection("Shipping Options");
    ptBullet("INR Bank Transfer — We ship via Brinks · Malca-Amit · FedEx: 3–4 day fully insured express shipping at a flat cost of USD 200, regardless of order value.");
    ptBullet("USD Bank Transfer — We ship via UPS or USPS: 9–12 day delivery at USD 120–140. Best suited for orders up to USD 7,000 (lower declared value to optimize import duties in 99% of cases).");
    ptBullet("PayPal Payment (10% surcharge) — We ship via UPS.com express at USD 120. Additional shipping options are available upon request.");
    ptY += 8;

    // Note
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8.5)
      .text("For custom shipping arrangements or further details, please contact our team directly.", ptX, ptY, { width: ptW, align: "center", lineBreak: true });

    drawPageFooter();

    // ══ THANK YOU PAGE ════════════════════════════════════════════════════════
    doc.addPage();
    doc.strokeColor(GOLD).lineWidth(1.2).moveTo(MX, 60).lineTo(PAGE_W - MX, 60).stroke();
    doc.strokeColor(GOLD_LIGHT).lineWidth(0.4).moveTo(MX, 64).lineTo(PAGE_W - MX, 64).stroke();

    [cx - 12, cx, cx + 12].forEach((dx) => doc.fillColor(GOLD).circle(dx, 100, 3).fill());

    doc.fillColor(GOLD).font("Playfair").fontSize(58)
      .text("Thank You", 0, 120, { width: PAGE_W, align: "center", lineBreak: false });
    doc.fillColor(BLACK).font("Playfair").fontSize(17)
      .text("for visiting our catalog", 0, 192, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 });

    doc.strokeColor(GOLD).lineWidth(0.8).moveTo(cx - 100, 226).lineTo(cx + 100, 226).stroke();
    doc.fillColor(GOLD).circle(cx, 226, 3).fill();
    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(10)
      .text("We look forward to crafting your next masterpiece.", 0, 242, { width: PAGE_W, align: "center", lineBreak: false });

    // Contact Us
    doc.strokeColor(RULE_COLOR).lineWidth(0.4).moveTo(MX + 60, 280).lineTo(PAGE_W - MX - 60, 280).stroke();
    doc.fillColor(GOLD).font("Playfair").fontSize(16)
      .text("Contact Us", 0, 296, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 2 });
    doc.fillColor(MID_GRAY).font("Helvetica").fontSize(9)
      .text("Our team is always ready to assist you", 0, 318, { width: PAGE_W, align: "center", lineBreak: false });

    // 4 boxes: 2x2 grid
    const boxW = (CW - 24) / 2;
    const boxH = 90;
    const boxGap = 24;
    const boxRowGap = 16;
    const box1X = MX;
    const box2X = MX + boxW + boxGap;
    const boxRow1Y = 350;
    const boxRow2Y = boxRow1Y + boxH + boxRowGap;

    const drawContactBox = (x: number, y: number, w: number, h: number, label: string, lines: { text: string; size?: number; bold?: boolean; url?: string }[]) => {
      doc.rect(x, y, w, h).strokeColor(GOLD_LIGHT).lineWidth(0.6).stroke();
      doc.fillColor(GOLD_LIGHT).font("Helvetica-Bold").fontSize(7)
        .text(label, x, y + 9, { width: w, align: "center", lineBreak: false });
      doc.strokeColor(GOLD_LIGHT).lineWidth(0.3).moveTo(x + 20, y + 20).lineTo(x + w - 20, y + 20).stroke();
      const headerH = 22;
      const contentH = lines.reduce((acc, l) => acc + (l.size ?? 10) + 6, 0);
      const remainingH = h - headerH;
      let lineY = y + headerH + Math.max(4, (remainingH - contentH) / 2);
      for (const line of lines) {
        const sz = line.size ?? 10;
        const fn = line.bold !== false ? "Helvetica-Bold" : "Helvetica";
        doc.fillColor(BLACK).font(fn).fontSize(sz)
          .text(line.text, x, lineY, { width: w, align: "center", lineBreak: false });
        // Add clickable link overlay covering the full row width
        if (line.url) {
          doc.link(x + 20, lineY - 2, w - 40, sz + 6, line.url);
        }
        lineY += sz + 6;
      }
    };

    // Box 1 (top-left): Phone Numbers — WhatsApp clickable links
    drawContactBox(box1X, boxRow1Y, boxW, boxH, "PHONE", [
      { text: "+91 63513 49740", size: 12, url: "https://wa.me/916351349740" },
      { text: "+91 93755 20003", size: 12, url: "https://wa.me/919375520003" },
      { text: "Sales & Enquiry", size: 8, bold: false },
    ]);

    // Box 2 (top-right): Emails — info first, then gmail
    drawContactBox(box2X, boxRow1Y, boxW, boxH, "EMAIL", [
      { text: "info@gemonediamond.com", size: 10 },
      { text: "Gemone.diamonds@gmail.com", size: 10 },
    ]);

    // Box 3 (bottom-left): Website
    drawContactBox(box1X, boxRow2Y, boxW, boxH, "WEBSITE", [
      { text: "https://gemonediamond.com", size: 11 },
      { text: "Visit us for the full collection", size: 8, bold: false },
    ]);

    // Box 4 (bottom-right): Social Media — with drawn icons
    { const bx = box2X; const by = boxRow2Y; const bw = boxW; const bh = boxH;
      doc.rect(bx, by, bw, bh).strokeColor(GOLD_LIGHT).lineWidth(0.6).stroke();
      doc.fillColor(GOLD_LIGHT).font("Helvetica-Bold").fontSize(7)
        .text("SOCIAL MEDIA", bx, by + 9, { width: bw, align: "center", lineBreak: false });
      doc.strokeColor(GOLD_LIGHT).lineWidth(0.3).moveTo(bx + 20, by + 20).lineTo(bx + bw - 20, by + 20).stroke();

      // Vertically center the two icon+text rows
      const smRowH = 18; const smGap = 10;
      const smTotalH = smRowH * 2 + smGap;
      const smStartY = by + 22 + Math.max(4, (bh - 22 - smTotalH) / 2);
      const iconSz = 14; // icon bounding size
      const iconTextGap = 8;
      const rowContentW = iconSz + iconTextGap + 160; // approx content width
      const rowStartX = bx + (bw - rowContentW) / 2;

      // ── Instagram icon (rounded square + inner circle + dot) ──────────────
      const ig1Y = smStartY + (smRowH - iconSz) / 2;
      const igR = 3; // corner radius approximated with arcs
      const igX = rowStartX; const igY = ig1Y;
      // Outer rounded rect using moveTo/lineTo/arc approximation
      doc.roundedRect(igX, igY, iconSz, iconSz, igR).strokeColor(GOLD).lineWidth(1.2).stroke();
      // Inner circle
      doc.circle(igX + iconSz / 2, igY + iconSz / 2, iconSz * 0.28).strokeColor(GOLD).lineWidth(1).stroke();
      // Top-right dot
      doc.circle(igX + iconSz - 3.5, igY + 3.5, 1.2).fillColor(GOLD).fill();
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(10)
        .text("@gemonellc", igX + iconSz + iconTextGap, smStartY + (smRowH - 10) / 2, { lineBreak: false });
      // Clickable Instagram link covering the full row
      doc.link(rowStartX, smStartY, bw - (rowStartX - bx) - 20, smRowH, "https://www.instagram.com/gemonellc/");

      // ── Facebook icon (circle with 'f') ───────────────────────────────────
      const fb2Y = smStartY + smRowH + smGap;
      const fbX = rowStartX; const fbY = fb2Y + (smRowH - iconSz) / 2;
      doc.circle(fbX + iconSz / 2, fbY + iconSz / 2, iconSz / 2).strokeColor(GOLD).lineWidth(1.2).stroke();
      doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(10)
        .text("f", fbX, fbY + 1, { width: iconSz, align: "center", lineBreak: false });
      doc.fillColor(BLACK).font("Helvetica-Bold").fontSize(10)
        .text("@gemonediamondUSA", fbX + iconSz + iconTextGap, fb2Y + (smRowH - 10) / 2, { lineBreak: false });
    }

    // Bottom footer
    doc.strokeColor(RULE_COLOR).lineWidth(0.4)
      .moveTo(MX + 60, boxRow2Y + boxH + 24).lineTo(PAGE_W - MX - 60, boxRow2Y + boxH + 24).stroke();
    doc.fillColor(LIGHT_GRAY).font("Helvetica").fontSize(8.5)
      .text("Authenticity  ·  Commitment  ·  Quality", 0, boxRow2Y + boxH + 38, { width: PAGE_W, align: "center", lineBreak: false, characterSpacing: 1 });

    drawPageFooter();

    doc.end();
  } catch (err) {
    console.error("Generate error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate catalog" });
  }
});

export default router;
