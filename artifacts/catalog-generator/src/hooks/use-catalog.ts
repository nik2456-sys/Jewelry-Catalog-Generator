import { useState } from "react";
import { useUploadExcel, useGenerateCatalog } from "@workspace/api-client-react";
import type { 
  ParsedExcelData, 
  PricingConfig, 
  GenerateCatalogRequestCatalogType,
  GenerateCatalogRequestKarat
} from "@workspace/api-client-react/src/generated/api.schemas";
import { useToast } from "@/hooks/use-toast";

export interface CatalogFormState {
  pricingConfig: PricingConfig;
  catalogType: GenerateCatalogRequestCatalogType;
  karat: GenerateCatalogRequestKarat;
  showItemizedCharges: boolean;
}

export function useCatalog() {
  const { toast } = useToast();
  const [parsedData, setParsedData] = useState<ParsedExcelData | null>(null);
  
  const [formState, setFormState] = useState<CatalogFormState>({
    pricingConfig: {
      goldPriceINR: 16500,
      diamondPriceUSD: 200,
      usdToInrRate: 83,
      labourPerGram: 20,
      wastageFixed: 20,
      handlingPercent: 5,
      profitPercent: 10,
      adminChargePercent: 0,
    },
    catalogType: "B2B",
    karat: "14K",
    showItemizedCharges: true,
  });

  const uploadMutation = useUploadExcel();
  const generateMutation = useGenerateCatalog();

  const handleUpload = async (file: File) => {
    try {
      const data = await uploadMutation.mutateAsync({ data: { file } });
      setParsedData(data);
      toast({
        title: "Excel Processed Successfully",
        description: `Loaded ${data.totalRows} jewelry items.`,
      });
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: "Could not process the Excel file. Please check the format.",
        variant: "destructive",
      });
      console.error(error);
    }
  };

  const updatePricing = (key: keyof PricingConfig, value: number) => {
    setFormState(prev => ({
      ...prev,
      pricingConfig: {
        ...prev.pricingConfig,
        [key]: value
      }
    }));
  };

  const updateField = <K extends keyof CatalogFormState>(key: K, value: CatalogFormState[K]) => {
    setFormState(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const resetData = () => setParsedData(null);

  const handleGenerate = async () => {
    if (!parsedData) return;

    try {
      const blob = await generateMutation.mutateAsync({
        data: {
          items: parsedData.items,
          pricingConfig: formState.pricingConfig,
          catalogType: formState.catalogType,
          karat: formState.karat,
          showItemizedCharges: formState.showItemizedCharges,
        }
      });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Gemone_${formState.catalogType}_Catalog_${formState.karat}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: "Catalog Generated",
        description: "Your PDF has been downloaded successfully.",
      });
    } catch (error) {
      toast({
        title: "Generation Failed",
        description: "An error occurred while building the PDF.",
        variant: "destructive",
      });
      console.error(error);
    }
  };

  return {
    parsedData,
    formState,
    isUploading: uploadMutation.isPending,
    isGenerating: generateMutation.isPending,
    handleUpload,
    handleGenerate,
    updatePricing,
    updateField,
    resetData,
  };
}
