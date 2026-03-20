import { motion } from "framer-motion";
import type { ParsedExcelData } from "@workspace/api-client-react/src/generated/api.schemas";
import { Link, ImageOff } from "lucide-react";

interface JewelryTableProps {
  data: ParsedExcelData;
}

function ImageCell({ url, label }: { url?: string; label: string }) {
  if (!url) {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="w-10 h-10 rounded border border-dashed border-border flex items-center justify-center bg-background text-muted-foreground">
          <ImageOff className="w-4 h-4 opacity-40" />
        </div>
        <span className="text-[10px] text-muted-foreground">{label}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <a href={url} target="_blank" rel="noopener noreferrer" className="group">
        <div className="w-10 h-10 rounded border border-border overflow-hidden bg-white shadow-sm group-hover:ring-2 group-hover:ring-primary/30 transition-all">
          <img
            src={url}
            alt={label}
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        </div>
      </a>
      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
        <Link className="w-2.5 h-2.5" />{label}
      </span>
    </div>
  );
}

export function JewelryTable({ data }: JewelryTableProps) {
  if (!data || !data.items || data.items.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full glass-panel rounded-2xl overflow-hidden mb-12"
    >
      <div className="px-6 py-4 border-b border-border bg-white/50 flex justify-between items-center">
        <h3 className="font-serif text-lg font-bold text-secondary">Data Preview</h3>
        <span className="text-sm font-medium text-muted-foreground bg-background px-3 py-1 rounded-full border border-border">
          {data.totalRows} Items Loaded
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground uppercase bg-background/50 border-b border-border">
            <tr>
              <th className="px-4 py-4 font-bold">Sr</th>
              <th className="px-4 py-4 font-bold text-center">Images</th>
              <th className="px-4 py-4 font-bold">Title</th>
              <th className="px-4 py-4 font-bold text-right">10K (g)</th>
              <th className="px-4 py-4 font-bold text-right">14K (g)</th>
              <th className="px-4 py-4 font-bold text-right">18K (g)</th>
              <th className="px-4 py-4 font-bold text-right">Center Dia</th>
              <th className="px-4 py-4 font-bold text-right">Side Dia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.items.map((item, idx) => (
              <motion.tr
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.05, 0.5) }}
                key={idx}
                className="bg-white/40 hover:bg-primary/5 transition-colors duration-150"
              >
                <td className="px-4 py-3 font-medium text-muted-foreground text-center">
                  {item.srNo}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-center">
                    <ImageCell url={item.imageLeft} label="Left" />
                    <ImageCell url={item.imageCenter} label="Center" />
                    <ImageCell url={item.imageRight} label="Right" />
                  </div>
                </td>
                <td className="px-4 py-3 font-serif font-bold text-secondary">
                  {item.title}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {item.weight10k?.toFixed(3) || "-"}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {item.weight14k?.toFixed(3) || "-"}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  {item.weight18k?.toFixed(3) || "-"}
                </td>
                <td className="px-4 py-3 text-right text-primary font-medium">
                  {item.centerDiamondWeight?.toFixed(3) || "-"}
                </td>
                <td className="px-4 py-3 text-right text-primary font-medium">
                  {item.sideDiamondWeight?.toFixed(3) || "-"}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
