import { motion } from "framer-motion";
import type { ParsedExcelData } from "@workspace/api-client-react/src/generated/api.schemas";
import { Image as ImageIcon } from "lucide-react";

interface JewelryTableProps {
  data: ParsedExcelData;
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
              <th className="px-6 py-4 font-bold">Sr No</th>
              <th className="px-6 py-4 font-bold">Image</th>
              <th className="px-6 py-4 font-bold">Title</th>
              <th className="px-6 py-4 font-bold text-right">10K (g)</th>
              <th className="px-6 py-4 font-bold text-right">14K (g)</th>
              <th className="px-6 py-4 font-bold text-right">18K (g)</th>
              <th className="px-6 py-4 font-bold text-right">Center Dia (ct)</th>
              <th className="px-6 py-4 font-bold text-right">Side Dia (ct)</th>
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
                <td className="px-6 py-4 font-medium text-muted-foreground">
                  {item.srNo}
                </td>
                <td className="px-6 py-4">
                  {item.imageBase64 ? (
                    <div className="w-12 h-12 rounded-lg border border-border overflow-hidden bg-white shadow-sm">
                      <img 
                        src={`data:${item.imageMimeType || 'image/png'};base64,${item.imageBase64}`} 
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div className="w-12 h-12 rounded-lg border border-border border-dashed flex items-center justify-center bg-background text-muted-foreground">
                      <ImageIcon className="w-5 h-5 opacity-50" />
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 font-serif font-bold text-secondary text-base">
                  {item.title}
                </td>
                <td className="px-6 py-4 text-right text-muted-foreground">
                  {item.weight10k?.toFixed(3) || "-"}
                </td>
                <td className="px-6 py-4 text-right text-muted-foreground">
                  {item.weight14k?.toFixed(3) || "-"}
                </td>
                <td className="px-6 py-4 text-right text-muted-foreground">
                  {item.weight18k?.toFixed(3) || "-"}
                </td>
                <td className="px-6 py-4 text-right text-primary font-medium">
                  {item.centerDiamondWeight?.toFixed(3) || "-"}
                </td>
                <td className="px-6 py-4 text-right text-primary font-medium">
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
