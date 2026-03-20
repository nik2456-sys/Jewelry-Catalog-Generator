import { useState } from "react";
import { useUploadExcel, useGenerateCatalog } from "@workspace/api-client-react";
import type {
  ParsedExcelData,
  PricingConfig,
  GenerateCatalogRequestCatalogType,
} from "@workspace/api-client-react/src/generated/api.schemas";
import { useToast } from "@/hooks/use-toast";

export interface CatalogFormState {
  pricingConfig: PricingConfig;
  catalogType: GenerateCatalogRequestCatalogType;
  showItemizedCharges: boolean;
}

export function useCatalog() {
  const { toast } = useToast();
  const [parsedData, setParsedData] = useState<ParsedExcelData | null>(null);
  const [removedSrNos, setRemovedSrNos] = useState<Set<number>>(new Set());

  const [formState, setFormState] = useState<CatalogFormState>({
    pricingConfig: {
      goldPriceUSD: 200,
      diamondPriceUSD: 200,
      labourPerGramUSD: 20,
      wastagePerGramUSD: 5,
      handlingPercent: 5,
      profitPercent: 10,
      adminChargePercent: 0,
    },
    catalogType: "B2B",
    showItemizedCharges: true,
  });

  const uploadMutation = useUploadExcel();
  const generateMutation = useGenerateCatalog();

  const isUploading = uploadMutation.isPending;
  const isGenerating = generateMutation.isPending;

  const updatePricing = (key: keyof PricingConfig, value: number) => {
    setFormState((prev) => ({
      ...prev,
      pricingConfig: { ...prev.pricingConfig, [key]: value },
    }));
  };

  const updateField = <K extends keyof CatalogFormState>(key: K, value: CatalogFormState[K]) => {
    setFormState((prev) => ({ ...prev, [key]: value }));
  };

  const toggleRemoveItem = (srNo: number) => {
    setRemovedSrNos((prev) => {
      const next = new Set(prev);
      if (next.has(srNo)) next.delete(srNo);
      else next.add(srNo);
      return next;
    });
  };

  const handleUpload = async (file: File) => {
    try {
      const result = await uploadMutation.mutateAsync({ data: { file } });
      setParsedData(result);
      setRemovedSrNos(new Set());
      toast({ title: `${result.totalRows} items loaded`, description: "Configure pricing and generate your catalog." });
    } catch {
      toast({ title: "Upload failed", description: "Please check your Excel file format.", variant: "destructive" });
    }
  };

  const handleGenerate = async () => {
    if (!parsedData) return;
    const filteredItems = parsedData.items.filter((item) => !removedSrNos.has(item.srNo));
    if (filteredItems.length === 0) {
      toast({ title: "No items selected", description: "Re-add at least one product before generating.", variant: "destructive" });
      return;
    }
    try {
      const blob = await generateMutation.mutateAsync({
        data: {
          items: filteredItems,
          pricingConfig: formState.pricingConfig,
          catalogType: formState.catalogType,
          showItemizedCharges: formState.showItemizedCharges,
        },
      });
      const url = URL.createObjectURL(blob as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gemone-diamond-${formState.catalogType.toLowerCase()}-catalog.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Catalog generated!", description: "Your PDF has been downloaded." });
    } catch {
      toast({ title: "Generation failed", description: "Please try again.", variant: "destructive" });
    }
  };

  const resetData = () => {
    setParsedData(null);
    setRemovedSrNos(new Set());
  };

  const activeItemCount = parsedData ? parsedData.items.length - removedSrNos.size : 0;

  return {
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
  };
}
