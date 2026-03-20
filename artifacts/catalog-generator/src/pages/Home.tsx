import { FileDown, RefreshCw, Sparkles } from "lucide-react";
import { useCatalog } from "@/hooks/use-catalog";
import { UploadArea } from "@/components/UploadArea";
import { ConfigPanel } from "@/components/ConfigPanel";
import { JewelryTable } from "@/components/JewelryTable";
import { motion } from "framer-motion";

export default function Home() {
  const {
    parsedData,
    formState,
    isUploading,
    isGenerating,
    handleUpload,
    handleGenerate,
    updatePricing,
    updateField,
    resetData,
    removedSrNos,
    toggleRemoveItem,
    activeItemCount,
  } = useCatalog();

  return (
    <div className="min-h-screen relative pb-24">
      {/* Elegant Hero Background */}
      <div className="absolute inset-0 z-0 h-[50vh] overflow-hidden">
        <img 
          src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
          alt="Luxury Background"
          className="w-full h-full object-cover opacity-40 object-top"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/80 to-background" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12">
        {/* Header */}
        <header className="flex flex-col items-center justify-center mb-12">
          <motion.img 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            src={`${import.meta.env.BASE_URL}images/logo.png`} 
            alt="Gemone Diamond" 
            className="w-20 h-20 md:w-24 md:h-24 mb-6 drop-shadow-md"
          />
          <motion.h1 
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-4xl md:text-5xl font-serif font-bold text-secondary text-center tracking-tight"
          >
            Gemone Diamond <br/>
            <span className="gold-gradient-text text-3xl md:text-4xl">Catalog Generator</span>
          </motion.h1>
          <motion.p 
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-4 text-muted-foreground font-medium max-w-lg text-center"
          >
            Create stunning, professional PDF catalogs instantly from your Excel data. Configurable for both B2B and B2C pricing models.
          </motion.p>
        </header>

        {/* Main Content Area */}
        <main>
          {!parsedData ? (
            <UploadArea onUpload={handleUpload} isUploading={isUploading} />
          ) : (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-8"
            >
              {/* Action Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
                <button
                  onClick={resetData}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold text-secondary bg-white border border-border hover:bg-background hover:border-primary/40 transition-all shadow-sm"
                >
                  <RefreshCw className="w-4 h-4" />
                  Upload Different File
                </button>

                <button
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-8 py-3.5 rounded-full text-base font-bold gold-gradient-bg disabled:opacity-70 disabled:cursor-not-allowed transform hover:-translate-y-0.5 transition-all duration-200"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Generating PDF...
                    </>
                  ) : (
                    <>
                      <FileDown className="w-5 h-5" />
                      Generate {formState.catalogType} Catalog ({activeItemCount} items · 10K · 14K · 18K)
                      <Sparkles className="w-4 h-4 ml-1 opacity-70" />
                    </>
                  )}
                </button>
              </div>

              <ConfigPanel 
                formState={formState}
                updatePricing={updatePricing}
                updateField={updateField}
              />
              
              <JewelryTable
                data={parsedData}
                removedSrNos={removedSrNos}
                onToggleRemove={toggleRemoveItem}
              />

            </motion.div>
          )}
        </main>
      </div>
    </div>
  );
}
