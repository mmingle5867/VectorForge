/**
 * VectorForge - Authentication Utilities
 * Helper functions for working with Clerk auth in server components and API routes.
 */

import { auth, currentUser } from '@clerk/nextjs/server';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * Get the current authenticated user from the database.
 * Creates the user record if it doesn't exist (handles race condition with webhook).
 * Also ensures UserSettings exist (creates defaults if missing).
 */
export async function getCurrentUser() {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return null;
  }

  // Try to find existing user
  let user = await prisma.user.findUnique({
    where: { clerkId },
    include: { settings: true },
  });

  // If user doesn't exist (webhook hasn't fired yet), create from Clerk data
  if (!user) {
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    const email = clerkUser.emailAddresses[0]?.emailAddress;
    if (!email) return null;

    try {
      user = await prisma.user.create({
        data: {
          clerkId,
          email,
          firstName: clerkUser.firstName,
          lastName: clerkUser.lastName,
          imageUrl: clerkUser.imageUrl,
          settings: {
            create: {}, // Create with defaults
          },
        },
        include: { settings: true },
      });

      logger.info('Auth: Created user from Clerk data (webhook race condition)', {
        clerkId,
        email,
      });
    } catch (error) {
      // Handle unique constraint violation (webhook fired between check and create)
      user = await prisma.user.findUnique({
        where: { clerkId },
        include: { settings: true },
      });
    }
  }

  // Ensure UserSettings exist (fallback if user was created without settings)
  if (user && !user.settings) {
    try {
      const settings = await prisma.userSettings.create({
        data: {
          userId: user.id,
        },
      });

      user = {
        ...user,
        settings,
      };

      logger.info('Auth: Created default UserSettings for existing user', {
        userId: user.id,
      });
    } catch (error) {
      // Settings might have been created concurrently
      const settings = await prisma.userSettings.findUnique({
        where: { userId: user.id },
      });
      if (settings) {
        user = { ...user, settings };
      }
    }
  }

  return user;
}

/**
 * Get user ID from Clerk auth (for API routes).
 * Returns the internal database user ID, not the Clerk ID.
 */
export async function getAuthenticatedUserId(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.id || null;
}

/**
 * Require authentication - throws if not authenticated.
 * Use in API routes that require auth.
 */
export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error('Unauthorized');
  }
  return user;
}