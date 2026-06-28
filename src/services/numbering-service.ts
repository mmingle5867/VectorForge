import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

const DEFAULT_SEQUENCES = [
  { sequenceKey: 'artwork', label: 'Artwork', prefix: 'ART', paddingLength: 6, startingNumber: 1 },
  { sequenceKey: 'digital', label: 'Digital', prefix: 'DIGI', paddingLength: 6, startingNumber: 1 },
  { sequenceKey: 'laser', label: 'Laser', prefix: 'LASR', paddingLength: 6, startingNumber: 1 },
  { sequenceKey: 'vinyl', label: 'Vinyl', prefix: 'VNYL', paddingLength: 6, startingNumber: 1 },
  { sequenceKey: 'cnc', label: 'CNC', prefix: 'CNC', paddingLength: 6, startingNumber: 1 },
  { sequenceKey: 'sewing', label: 'Sewing', prefix: 'SEW', paddingLength: 6, startingNumber: 1 },
  { sequenceKey: 'print', label: 'Print', prefix: 'PRNT', paddingLength: 6, startingNumber: 1 },
  { sequenceKey: 'bundle', label: 'Bundle', prefix: 'BNDL', paddingLength: 6, startingNumber: 1 },
] as const;

type TransactionClient = Prisma.TransactionClient;

type NumberContext = {
  itemId?: string | null;
  batchId?: string | null;
  artworkId?: string | null;
  assetProfileId?: string | null;
  notes?: string | null;
};

type AssignLinks = {
  itemId?: string | null;
  batchId?: string | null;
  artworkId?: string | null;
  assetProfileId?: string | null;
  notes?: string | null;
};

export function formatIssuedNumber(
  prefix: string,
  numericSequence: number,
  paddingLength: number
) {
  return `${prefix}-${String(numericSequence).padStart(paddingLength, '0')}`;
}

export async function ensureDefaultSequences(client: TransactionClient | typeof prisma = prisma) {
  for (const sequence of DEFAULT_SEQUENCES) {
    await client.numberSequence.upsert({
      where: { sequenceKey: sequence.sequenceKey },
      update: {},
      create: {
        ...sequence,
        nextNumber: sequence.startingNumber,
      },
    });
  }
}

async function lockSequence(tx: TransactionClient, sequenceKey: string) {
  await tx.$queryRaw`
    SELECT id FROM "number_sequences"
    WHERE "sequenceKey" = ${sequenceKey}
    FOR UPDATE
  `;

  const sequence = await tx.numberSequence.findUnique({
    where: { sequenceKey },
  });

  if (!sequence || !sequence.isActive) {
    throw new Error(`Number sequence is not available: ${sequenceKey}`);
  }

  return sequence;
}

async function issueNumberInTransaction(
  tx: TransactionClient,
  sequenceKey: string,
  context: NumberContext = {},
  numericOverride?: number
) {
  const sequence = await lockSequence(tx, sequenceKey);
  const numericSequence = numericOverride ?? sequence.nextNumber;
  const issuedNumber = formatIssuedNumber(
    sequence.prefix,
    numericSequence,
    sequence.paddingLength
  );
  const assigned = Boolean(
    context.itemId ||
      context.batchId ||
      context.artworkId ||
      context.assetProfileId
  );

  const number = await tx.issuedNumber.create({
    data: {
      sequenceKey,
      prefix: sequence.prefix,
      numericSequence,
      issuedNumber,
      itemId: context.itemId ?? null,
      batchId: context.batchId ?? null,
      artworkId: context.artworkId ?? null,
      assetProfileId: context.assetProfileId ?? null,
      status: assigned ? 'ASSIGNED' : 'ISSUED',
      assignedAt: assigned ? new Date() : null,
      notes: context.notes ?? null,
    },
  });

  const nextNumber = Math.max(sequence.nextNumber, numericSequence + 1);
  const lastIssuedNumber =
    sequence.lastIssuedNumber === null
      ? numericSequence
      : Math.max(sequence.lastIssuedNumber, numericSequence);

  await tx.numberSequence.update({
    where: { id: sequence.id },
    data: {
      nextNumber,
      lastIssuedNumber,
    },
  });

  return number;
}

export async function issueNumber(sequenceKey: string, context: NumberContext = {}) {
  await ensureDefaultSequences();
  return prisma.$transaction(async (tx) => issueNumberInTransaction(tx, sequenceKey, context));
}

export async function assignNumber(issuedNumberId: string, links: AssignLinks) {
  return prisma.issuedNumber.update({
    where: { id: issuedNumberId },
    data: {
      itemId: links.itemId ?? undefined,
      batchId: links.batchId ?? undefined,
      artworkId: links.artworkId ?? undefined,
      assetProfileId: links.assetProfileId ?? undefined,
      notes: links.notes ?? undefined,
      status: 'ASSIGNED',
      assignedAt: new Date(),
    },
  });
}

export async function voidNumber(issuedNumberId: string, reason: string) {
  return prisma.issuedNumber.update({
    where: { id: issuedNumberId },
    data: {
      status: 'VOIDED',
      voidedAt: new Date(),
      notes: reason,
    },
  });
}

export async function retireNumber(issuedNumberId: string, reason: string) {
  return prisma.issuedNumber.update({
    where: { id: issuedNumberId },
    data: {
      status: 'RETIRED',
      notes: reason,
    },
  });
}

export async function ensureArtworkIdentityForBatchItem(input: {
  itemId: string;
  batchId: string;
  userId: string;
  title: string;
  ownerId?: string | null;
  workspaceId?: string | null;
  semaItemId?: string | null;
}) {
  await ensureDefaultSequences();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM "batch_items"
      WHERE id = ${input.itemId}
      FOR UPDATE
    `;

    const item = await tx.batchItem.findUnique({
      where: { id: input.itemId },
      include: {
        artwork: true,
        assetProfile: true,
      },
    });

    if (!item || item.batchId !== input.batchId) {
      throw new Error('Batch item not found for artwork identity assignment');
    }

    if (
      item.artworkId &&
      item.assetProfileId &&
      item.artworkNumber &&
      item.profileNumber
    ) {
      return {
        artworkId: item.artworkId,
        assetProfileId: item.assetProfileId,
        artworkNumber: item.artworkNumber,
        profileNumber: item.profileNumber,
      };
    }

    let artwork = item.artwork;

    if (!artwork) {
      const artworkNumber = await issueNumberInTransaction(tx, 'artwork', {
        itemId: item.id,
        batchId: input.batchId,
        notes: 'Allocated during first approve/save',
      });

      artwork = await tx.artwork.create({
        data: {
          userId: input.userId,
          ownerId: input.ownerId ?? null,
          workspaceId: input.workspaceId ?? null,
          itemId: input.semaItemId ?? null,
          artworkNumber: artworkNumber.issuedNumber,
          numericSequence: artworkNumber.numericSequence,
          title: input.title,
          sourceItemId: item.id,
        },
      });

      await tx.issuedNumber.update({
        where: { id: artworkNumber.id },
        data: {
          artworkId: artwork.id,
          status: 'ASSIGNED',
          assignedAt: artworkNumber.assignedAt ?? new Date(),
        },
      });
    } else if (
      (input.ownerId && artwork.ownerId !== input.ownerId) ||
      (input.workspaceId && artwork.workspaceId !== input.workspaceId) ||
      (input.semaItemId && artwork.itemId !== input.semaItemId)
    ) {
      artwork = await tx.artwork.update({
        where: { id: artwork.id },
        data: {
          ownerId: input.ownerId ?? artwork.ownerId,
          workspaceId: input.workspaceId ?? artwork.workspaceId,
          itemId: input.semaItemId ?? artwork.itemId,
        },
      });
    }

    let digitalProfile = item.assetProfile;

    if (!digitalProfile) {
      digitalProfile = await tx.assetProfile.findUnique({
        where: {
          artworkId_profileType: {
            artworkId: artwork.id,
            profileType: 'DIGITAL',
          },
        },
      });
    }

    if (!digitalProfile) {
      const digitalNumber = await issueNumberInTransaction(
        tx,
        'digital',
        {
          itemId: item.id,
          batchId: input.batchId,
          artworkId: artwork.id,
          notes: 'Default digital profile allocated during first approve/save',
        },
        artwork.numericSequence
      );

      digitalProfile = await tx.assetProfile.create({
        data: {
          artworkId: artwork.id,
          profileType: 'DIGITAL',
          profileNumber: digitalNumber.issuedNumber,
          numericSequence: artwork.numericSequence,
        },
      });

      await tx.issuedNumber.update({
        where: { id: digitalNumber.id },
        data: {
          assetProfileId: digitalProfile.id,
          status: 'ASSIGNED',
          assignedAt: digitalNumber.assignedAt ?? new Date(),
        },
      });
    }

    await tx.batchItem.update({
      where: { id: item.id },
      data: {
        artworkId: artwork.id,
        assetProfileId: digitalProfile.id,
        artworkNumber: artwork.artworkNumber,
        profileNumber: digitalProfile.profileNumber,
      },
    });

    return {
      artworkId: artwork.id,
      assetProfileId: digitalProfile.id,
      artworkNumber: artwork.artworkNumber,
      profileNumber: digitalProfile.profileNumber,
      semaItemId: input.semaItemId ?? null,
    };
  });
}
