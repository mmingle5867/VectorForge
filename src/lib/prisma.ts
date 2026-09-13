import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  semaIdentityMiddlewareRegistered: boolean | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

const MODEL_IDENTITY: Record<string, { typeCode: string; identityField?: string }> = {
  User: { typeCode: 'USR' },
  UserSettings: { typeCode: 'PST' },
  Batch: { typeCode: 'CMD' },
  BatchItem: { typeCode: 'ITM' },
  NumberSequence: { typeCode: 'SNP' },
  IssuedNumber: { typeCode: 'RSL' },
  Artwork: { typeCode: 'ART', identityField: 'artworkNumber' },
  AssetProfile: { typeCode: 'PRF', identityField: 'profileNumber' },
  ProductVariant: { typeCode: 'ITM' },
  Owner: { typeCode: 'OWN', identityField: 'ownerId' },
  Workspace: { typeCode: 'WSP', identityField: 'workspaceId' },
  Item: { typeCode: 'ITM', identityField: 'itemId' },
  Asset: { typeCode: 'AST', identityField: 'assetId' },
  Relationship: { typeCode: 'REL', identityField: 'relationshipId' },
  RelationshipMember: { typeCode: 'REL' },
  Document: { typeCode: 'DOC', identityField: 'documentId' },
  SemaProfile: { typeCode: 'PRF', identityField: 'profileId' },
  StorageLocation: { typeCode: 'LOC', identityField: 'locationId' },
  AssetVersion: { typeCode: 'SNP', identityField: 'assetVersionId' },
  AssetLocation: { typeCode: 'LOC' },
  Category: { typeCode: 'CAT', identityField: 'categoryId' },
  ItemCategory: { typeCode: 'REL' },
  RelationshipCategory: { typeCode: 'REL' },
  DashboardPreference: { typeCode: 'PST' },
};

async function addCoreIdentity(model: string, data: Record<string, unknown>) {
  if (typeof data.id === 'string' && data.id) return;
  const mapping = MODEL_IDENTITY[model];
  if (!mapping) return;

  const externalIdentity = mapping.identityField ? data[mapping.identityField] : null;
  if (typeof externalIdentity === 'string' && externalIdentity) {
    const { parseSemaId } = await import('@/lib/sema-id');
    try {
      parseSemaId(externalIdentity);
      data.id = externalIdentity;
      return;
    } catch {
      // A caller-provided legacy identity remains available in its original
      // field, while the database row itself receives a new Core identity.
    }
  }

  const { issueSemaIdentifier } = await import('@/services/sema-core-identity');
  const issued = await issueSemaIdentifier(mapping.typeCode, {
    purpose: 'database-row-identity',
    model,
  });
  data.id = issued.id;
  if (mapping.identityField && !data[mapping.identityField]) {
    data[mapping.identityField] = issued.id;
  }
}

if (!globalForPrisma.semaIdentityMiddlewareRegistered) {
  prisma.$use(async (params, next) => {
    const mapping = params.model ? MODEL_IDENTITY[params.model] : null;
    if (!mapping || !params.args) return next(params);

    if (params.action === 'create' && params.args.data) {
      await addCoreIdentity(params.model!, params.args.data);
    } else if (params.action === 'createMany' && params.args.data) {
      const rows = Array.isArray(params.args.data) ? params.args.data : [params.args.data];
      for (const row of rows) await addCoreIdentity(params.model!, row);
    } else if (params.action === 'upsert' && params.args.create) {
      await addCoreIdentity(params.model!, params.args.create);
    }
    return next(params);
  });
  globalForPrisma.semaIdentityMiddlewareRegistered = true;
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
