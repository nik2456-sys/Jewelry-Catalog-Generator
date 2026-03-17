# Gemone Diamond Catalog Generator

## Overview

A professional jewelry catalog PDF generator for Gemone Diamond. Upload an Excel file containing jewelry data, configure pricing, and generate beautiful B2B or B2C PDF catalogs.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/catalog-generator)
- **API framework**: Express 5 (artifacts/api-server)
- **Database**: PostgreSQL + Drizzle ORM (not currently used)
- **Validation**: Zod (zod/v4), drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **PDF generation**: PDFKit
- **Excel parsing**: xlsx (SheetJS)
- **File upload**: multer

## Features

- Upload .xlsx Excel files with jewelry data (Sr No, Image, Title, 10K/14K/18K weight, Center Diamond, Side Diamond)
- Preview parsed data before generating
- B2B and B2C catalog modes with different pricing calculations
- Configurable gold price (INR), diamond price (USD), USD/INR rate, labour, wastage, handling, profit, admin charges
- Karat selection: 10K, 14K, 18K
- Toggle to show/hide itemized charge breakdown in PDF
- Professional PDF output with Gemone Diamond branding, gold/dark theme
- 2-4 products per page, high-quality images preserved

## Pricing Formulas

### B2B
- Metal (14K): (0.65 × goldPriceINR × weight14k) / 75 / usdToInrRate
- Metal (10K): (0.45 × goldPriceINR × weight10k) / 75 / usdToInrRate
- Metal (18K): (0.75 × goldPriceINR × weight18k) / 75 / usdToInrRate
- Center Diamond: centerDiamondWeight × diamondPriceUSD
- Side Diamond: sideDiamondWeight × diamondPriceUSD
- Labour: labourPerGram × metalWeight / usdToInrRate
- Wastage: wastageFixed / usdToInrRate
- Handling: subtotal × handlingPercent / 100
- Admin: subtotal × adminChargePercent / 100

### B2C
- Same metal/labour calculation as B2B
- Diamond: (center + side) × diamondPriceUSD
- Handling: subtotal × handlingPercent / 100
- Profit: (subtotal + handling) × profitPercent / 100

## Structure

```text
artifacts/
├── api-server/          # Express API server
│   └── src/routes/catalog.ts  # Excel upload + PDF generation
├── catalog-generator/   # React + Vite frontend
│   └── src/
│       ├── components/  # UploadArea, ConfigPanel, JewelryTable
│       ├── hooks/       # use-catalog.ts
│       └── pages/       # Home.tsx
lib/
├── api-spec/openapi.yaml   # API contract
├── api-client-react/       # Generated React Query hooks
├── api-zod/                # Generated Zod schemas
└── db/                     # Drizzle ORM (unused currently)
```

## Excel Format

Columns expected:
- Sr No
- Image (embedded image in cell)
- Title
- 10K Weight (grams)
- 14K Weight (grams)
- 18K Weight (grams)
- Center Diamond Weight (carats)
- Side Diamond Weight (carats)
