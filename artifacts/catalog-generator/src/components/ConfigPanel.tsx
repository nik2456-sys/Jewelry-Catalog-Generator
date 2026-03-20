import type React from "react";
import { Settings, Calculator, Percent, Coins, Gem } from "lucide-react";
import { motion } from "framer-motion";
import type { CatalogFormState } from "@/hooks/use-catalog";
import { cn } from "@/lib/utils";

// ── InputGroup defined OUTSIDE ConfigPanel to prevent remount-on-render ──────
interface InputGroupProps {
  label: string;
  value: number;
  onChange: (val: number) => void;
  icon?: React.ElementType;
  prefix?: string;
}

function InputGroup({ label, value, onChange, icon: Icon, prefix }: InputGroupProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm font-medium pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          type="number"
          value={value}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            onChange(isNaN(parsed) ? 0 : parsed);
          }}
          className={cn(
            "w-full bg-white border border-border rounded-xl px-4 py-2.5 text-secondary font-medium",
            "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200",
            prefix && "pl-8"
          )}
        />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface ConfigPanelProps {
  formState: CatalogFormState;
  updatePricing: (key: keyof CatalogFormState["pricingConfig"], value: number) => void;
  updateField: <K extends keyof CatalogFormState>(key: K, value: CatalogFormState[K]) => void;
}

export function ConfigPanel({ formState, updatePricing, updateField }: ConfigPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full glass-panel rounded-2xl overflow-hidden mb-8"
    >
      <div className="bg-secondary text-secondary-foreground px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-serif m-0">Catalog Configuration</h2>
        </div>

        <div className="flex bg-white/10 rounded-lg p-1 backdrop-blur-sm">
          {(["B2B", "B2C"] as const).map((type) => (
            <button
              key={type}
              onClick={() => updateField("catalogType", type)}
              className={cn(
                "px-6 py-1.5 rounded-md text-sm font-bold transition-all duration-200",
                formState.catalogType === type
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-white/70 hover:text-white hover:bg-white/5"
              )}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Core Pricing */}
        <div className="lg:col-span-9 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <InputGroup
            label="Gold Price/g (USD)"
            value={formState.pricingConfig.goldPriceUSD}
            onChange={(v) => updatePricing("goldPriceUSD", v)}
            prefix="$"
            icon={Coins}
          />
          <InputGroup
            label="Diamond Price/ct (USD)"
            value={formState.pricingConfig.diamondPriceUSD}
            onChange={(v) => updatePricing("diamondPriceUSD", v)}
            prefix="$"
            icon={Gem}
          />
          <InputGroup
            label="Labour per gram (USD)"
            value={formState.pricingConfig.labourPerGramUSD}
            onChange={(v) => updatePricing("labourPerGramUSD", v)}
            prefix="$"
            icon={Calculator}
          />

          {formState.catalogType === "B2B" && (
            <InputGroup
              label="Wastage per gram (USD)"
              value={formState.pricingConfig.wastagePerGramUSD}
              onChange={(v) => updatePricing("wastagePerGramUSD", v)}
              prefix="$"
            />
          )}

          <InputGroup
            label="Handling Charge"
            value={formState.pricingConfig.handlingPercent}
            onChange={(v) => updatePricing("handlingPercent", v)}
            prefix="%"
            icon={Percent}
          />

          {formState.catalogType === "B2C" && (
            <InputGroup
              label="Profit Margin"
              value={formState.pricingConfig.profitPercent}
              onChange={(v) => updatePricing("profitPercent", v)}
              prefix="%"
              icon={Percent}
            />
          )}

          {formState.catalogType === "B2B" && (
            <InputGroup
              label="Admin Charge"
              value={formState.pricingConfig.adminChargePercent}
              onChange={(v) => updatePricing("adminChargePercent", v)}
              prefix="%"
              icon={Percent}
            />
          )}
        </div>

        {/* PDF Options */}
        <div className="lg:col-span-3 border-t lg:border-t-0 lg:border-l border-border pt-6 lg:pt-0 lg:pl-8 flex flex-col justify-center">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">
            PDF Options
          </p>

          <label className="flex items-center gap-3 p-4 rounded-xl border border-border bg-background cursor-pointer hover:border-primary/30 transition-colors">
            <div className="relative flex items-center">
              <input
                type="checkbox"
                checked={formState.showItemizedCharges}
                onChange={(e) => updateField("showItemizedCharges", e.target.checked)}
                className="peer sr-only"
              />
              <div className="w-6 h-6 border-2 border-muted-foreground rounded bg-white peer-checked:bg-primary peer-checked:border-primary transition-all flex items-center justify-center">
                <svg className="w-4 h-4 text-white opacity-0 peer-checked:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </div>
            <div>
              <p className="text-sm font-bold text-secondary">Itemized Breakdown</p>
              <p className="text-xs text-muted-foreground">Show charge details on PDF</p>
            </div>
          </label>

          <div className="mt-4 p-3 rounded-xl bg-primary/5 border border-primary/20">
            <p className="text-xs font-bold text-primary mb-1">Prices Generated For:</p>
            <p className="text-xs text-muted-foreground">10K · 14K · 18K Gold</p>
            <p className="text-xs text-muted-foreground mt-1">EF Color · VS Clarity</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
