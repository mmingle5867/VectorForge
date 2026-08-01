export interface SkuGenerationInput {
  baseName: string;
  sequenceNumber: number;

  /**
   * Optional structured SKU components.
   * Providers may ignore fields they do not use.
   */
  appCode?: string;
  itemType?: string;
  profileType?: string;

  ownerId?: string;
  workspaceId?: string;
  itemId?: string;
  artworkId?: string;
  marketplace?: string;
}

export interface SkuGenerationResult {
  sku: string;
  providerId: string;
  strategyId: string;
  generatedAt: string;

  /**
   * Human-readable values used to construct the SKU.
   * Useful for auditing and future SEMA result comparison.
   */
  components: Record<string, string | number>;
}

export interface SkuProvider {
  id: string;
  name: string;
  strategyId: string;
  description: string;

  generate(input: SkuGenerationInput): Promise<SkuGenerationResult>;
}