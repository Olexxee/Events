import type { VybeCategory } from "@prisma/client";
import { getPrismaClient } from "../../infrastructure/database/prisma.js";

export async function listPublicOfferings(input: {
  category?: VybeCategory;
  city?: string;
  state?: string;
}) {
  const prisma = getPrismaClient();
  const active = await prisma.vybeCategoryActivation.findMany({
    where: { isActive: true },
    select: { category: true }
  });
  const activeCategories = active
    .map((item) => item.category)
    .filter((category) => !input.category || category === input.category);
  if (activeCategories.length === 0) return [];

  const offerings = await prisma.vybeOffering.findMany({
    where: { status: "PUBLISHED", category: { in: activeCategories } },
    include: {
      versions: true,
      providerProfile: {
        select: {
          organization: { select: { name: true, status: true } },
          approvals: {
            where: {
              status: "ACTIVE",
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
            },
            select: { category: true }
          }
        }
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });

  return offerings.flatMap((offering) => {
    const version = offering.versions.find(
      (item) =>
        item.version === offering.currentPublishedVersion &&
        item.status === "PUBLISHED"
    );
    if (!version || offering.providerProfile.organization.status !== "ACTIVE") {
      return [];
    }
    if (!offering.providerProfile.approvals.some(
      (approval) => approval.category === offering.category
    )) return [];

    const content = version.content as Record<string, unknown>;
    const location = content.location as Record<string, unknown> | undefined;
    if (input.city && String(location?.city ?? "").toLowerCase() !== input.city.toLowerCase()) return [];
    if (input.state && String(location?.state ?? "").toLowerCase() !== input.state.toLowerCase()) return [];

    return [{
      id: offering.id,
      category: offering.category,
      providerName: offering.providerProfile.organization.name,
      version: version.version,
      content: version.content,
      publishedAt: version.publishedAt
    }];
  });
}
