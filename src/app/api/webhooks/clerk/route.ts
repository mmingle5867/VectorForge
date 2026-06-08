/**
 * VectorForge - Clerk Webhook Handler
 * Syncs user data from Clerk to the local database.
 * 
 * Setup:
 * 1. In Clerk Dashboard → Webhooks, create a new endpoint
 * 2. Set URL to: https://your-domain.com/api/webhooks/clerk
 * 3. Subscribe to events: user.created, user.updated, user.deleted
 * 4. Copy the signing secret to CLERK_WEBHOOK_SECRET in .env.local
 */

import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

// Clerk webhook event types
interface ClerkWebhookEvent {
  type: string;
  data: {
    id: string;
    email_addresses: Array<{
      email_address: string;
      id: string;
    }>;
    first_name: string | null;
    last_name: string | null;
    image_url: string | null;
  };
}

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    logger.error('Clerk webhook: CLERK_WEBHOOK_SECRET not configured');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    );
  }

  // Get the headers
  const headerPayload = await headers();
  const svix_id = headerPayload.get('svix-id');
  const svix_timestamp = headerPayload.get('svix-timestamp');
  const svix_signature = headerPayload.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    logger.warn('Clerk webhook: Missing svix headers');
    return NextResponse.json(
      { error: 'Missing webhook verification headers' },
      { status: 400 }
    );
  }

  // Get the body
  const payload = await req.json();
  const body = JSON.stringify(payload);

  // Verify the webhook signature
  const wh = new Webhook(WEBHOOK_SECRET);
  let event: ClerkWebhookEvent;

  try {
    event = wh.verify(body, {
      'svix-id': svix_id,
      'svix-timestamp': svix_timestamp,
      'svix-signature': svix_signature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    logger.error('Clerk webhook: Verification failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: 'Webhook verification failed' },
      { status: 400 }
    );
  }

  // Handle the event
  const { type, data } = event;

  logger.info(`Clerk webhook: Received event ${type}`, { clerkId: data.id });

  try {
    switch (type) {
      case 'user.created': {
        const email = data.email_addresses[0]?.email_address;
        if (!email) {
          logger.warn('Clerk webhook: No email found for user', { clerkId: data.id });
          break;
        }

        await prisma.user.create({
          data: {
            clerkId: data.id,
            email,
            firstName: data.first_name,
            lastName: data.last_name,
            imageUrl: data.image_url,
          },
        });

        // Create default settings for the new user
        const user = await prisma.user.findUnique({
          where: { clerkId: data.id },
        });

        if (user) {
          await prisma.userSettings.create({
            data: {
              userId: user.id,
            },
          });
        }

        logger.info('Clerk webhook: User created', { clerkId: data.id, email });
        break;
      }

      case 'user.updated': {
        const email = data.email_addresses[0]?.email_address;

        await prisma.user.update({
          where: { clerkId: data.id },
          data: {
            email: email || undefined,
            firstName: data.first_name,
            lastName: data.last_name,
            imageUrl: data.image_url,
          },
        });

        logger.info('Clerk webhook: User updated', { clerkId: data.id });
        break;
      }

      case 'user.deleted': {
        await prisma.user.delete({
          where: { clerkId: data.id },
        });

        logger.info('Clerk webhook: User deleted', { clerkId: data.id });
        break;
      }

      default:
        logger.debug(`Clerk webhook: Unhandled event type ${type}`);
    }
  } catch (error) {
    logger.error(`Clerk webhook: Error processing ${type}`, {
      error: error instanceof Error ? error.message : String(error),
      clerkId: data.id,
    });
    return NextResponse.json(
      { error: 'Error processing webhook' },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}