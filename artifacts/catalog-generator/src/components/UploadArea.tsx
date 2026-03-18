import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { UploadCloud, FileSpreadsheet, Loader2, Download } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface UploadAreaProps {
  onUpload: (file: File) => void;
  isUploading: boolean;
}

export function UploadArea({ onUpload, isUploading }: UploadAreaProps) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      onUpload(acceptedFiles[0]);
    }
  }, [onUpload]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls']
    },
    maxFiles: 1,
    disabled: isUploading
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="w-full max-w-2xl mx-auto mt-12 space-y-4"
    >
      {/* Upload dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          "relative overflow-hidden group cursor-pointer rounded-2xl glass-panel p-12 text-center transition-all duration-300",
          isDragActive ? "border-primary bg-primary/5 scale-[1.02]" : "border-border hover:border-primary/50 hover:shadow-xl",
          isUploading && "opacity-70 pointer-events-none"
        )}
      >
        <input {...getInputProps()} />

        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

        <div className="relative z-10 flex flex-col items-center gap-6">
          <div className={cn(
            "p-5 rounded-full transition-colors duration-300",
            isDragActive ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground"
          )}>
            {isUploading ? (
              <Loader2 className="w-10 h-10 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-10 h-10" />
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-serif font-semibold text-secondary">
              {isUploading ? "Processing Excel File..." : "Upload Jewelry Data"}
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {isDragActive
                ? "Drop the file here to begin parsing"
                : "Drag and drop your .xlsx catalog file here, or click to browse your computer."}
            </p>
          </div>

          {!isUploading && (
            <div className="flex items-center gap-2 text-sm text-primary font-medium mt-4 bg-primary/5 px-4 py-2 rounded-full">
              <UploadCloud className="w-4 h-4" />
              Supported format: Excel (.xlsx)
            </div>
          )}
        </div>
      </div>

      {/* Sample Excel download */}
      <div className="flex items-center justify-center gap-3 pt-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Not sure about the format?</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <a
        href="/api/catalog/sample"
        download="gemone-catalog-sample.xlsx"
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-center gap-2.5 w-full py-3 px-5 rounded-xl border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 transition-all duration-200 group"
      >
        <Download className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
        <span className="text-sm font-semibold text-primary">Download Sample Excel File</span>
        <span className="text-xs text-muted-foreground ml-1">(5 sample rows with correct column headers)</span>
      </a>
    </motion.div>
  );
}
