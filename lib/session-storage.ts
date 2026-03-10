import { Session } from "@shopify/shopify-api";
import prisma from "./prisma";

// SessionStorage interface — matches @shopify/shopify-api's internal contract
interface SessionStorage {
  storeSession(session: Session): Promise<boolean>;
  loadSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<boolean>;
  deleteSessions(ids: string[]): Promise<boolean>;
  findSessionsByShop(shop: string): Promise<Session[]>;
}

function rowToSession(row: {
  id: string;
  shop: string;
  state: string;
  isOnline: boolean;
  scope: string | null;
  expires: Date | null;
  accessToken: string;
}): Session {
  const session = new Session({
    id: row.id,
    shop: row.shop,
    state: row.state,
    isOnline: row.isOnline,
  });
  session.scope = row.scope ?? undefined;
  session.expires = row.expires ?? undefined;
  session.accessToken = row.accessToken;
  return session;
}

/**
 * Prisma-backed session storage for @shopify/shopify-api v12.
 * Hand-rolled to avoid peer-dep conflicts with shopify-app-session-storage-prisma.
 */
export class PrismaSessionStorage implements SessionStorage {
  async storeSession(session: Session): Promise<boolean> {
    try {
      await prisma.session.upsert({
        where: { id: session.id },
        update: {
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline,
          scope: session.scope ?? null,
          expires: session.expires ?? null,
          accessToken: session.accessToken ?? "",
          userId: session.onlineAccessInfo?.associated_user?.id
            ? BigInt(session.onlineAccessInfo.associated_user.id)
            : null,
          firstName: session.onlineAccessInfo?.associated_user?.first_name ?? null,
          lastName: session.onlineAccessInfo?.associated_user?.last_name ?? null,
          email: session.onlineAccessInfo?.associated_user?.email ?? null,
          accountOwner: session.onlineAccessInfo?.associated_user?.account_owner ?? false,
          locale: session.onlineAccessInfo?.associated_user?.locale ?? null,
          collaborator: session.onlineAccessInfo?.associated_user?.collaborator ?? false,
          emailVerified: session.onlineAccessInfo?.associated_user?.email_verified ?? false,
        },
        create: {
          id: session.id,
          shop: session.shop,
          state: session.state,
          isOnline: session.isOnline,
          scope: session.scope ?? null,
          expires: session.expires ?? null,
          accessToken: session.accessToken ?? "",
          userId: session.onlineAccessInfo?.associated_user?.id
            ? BigInt(session.onlineAccessInfo.associated_user.id)
            : null,
          firstName: session.onlineAccessInfo?.associated_user?.first_name ?? null,
          lastName: session.onlineAccessInfo?.associated_user?.last_name ?? null,
          email: session.onlineAccessInfo?.associated_user?.email ?? null,
          accountOwner: session.onlineAccessInfo?.associated_user?.account_owner ?? false,
          locale: session.onlineAccessInfo?.associated_user?.locale ?? null,
          collaborator: session.onlineAccessInfo?.associated_user?.collaborator ?? false,
          emailVerified: session.onlineAccessInfo?.associated_user?.email_verified ?? false,
        },
      });
      return true;
    } catch (err) {
      console.error("[PrismaSessionStorage] storeSession failed:", err);
      return false;
    }
  }

  async loadSession(id: string): Promise<Session | undefined> {
    try {
      const row = await prisma.session.findUnique({ where: { id } });
      if (!row) return undefined;
      return rowToSession(row);
    } catch (err) {
      console.error("[PrismaSessionStorage] loadSession failed:", err);
      return undefined;
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      await prisma.session.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    try {
      await prisma.session.deleteMany({ where: { id: { in: ids } } });
      return true;
    } catch {
      return false;
    }
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    try {
      const rows = await prisma.session.findMany({ where: { shop } });
      return rows.map(rowToSession);
    } catch {
      return [];
    }
  }
}
