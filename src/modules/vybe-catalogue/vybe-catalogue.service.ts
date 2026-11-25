import type { VybeCategory } from "@prisma/client";
import {
  activateCategory,
  createOfferingDraft,
  listPublicOfferings,
  publishOffering,
  updateOfferingDraft
} from "./vybe-catalogue.db.js";
import type { VybeOfferingContent } from "./vybe-catalogue.validators.js";

export function createVybeOffering(input: { organizationId: string; actorUserId: string; category: VybeCategory; content: VybeOfferingContent }) {
  return createOfferingDraft(input);
}
export function updateVybeOffering(input: { offeringId: string; actorUserId: string; content: VybeOfferingContent }) {
  return updateOfferingDraft(input);
}
export function publishVybeOffering(input: { offeringId: string; actorUserId: string }) {
  return publishOffering(input);
}
export function setVybeCategoryActivation(input: { category: VybeCategory; actorUserId: string; active: boolean; reason: string; checks: { key: string; completed: true; evidenceReference: string; notes: string }[] }) {
  return activateCategory(input);
}
export function discoverVybeOfferings(input: { category?: VybeCategory; city?: string; state?: string }) {
  return listPublicOfferings(input);
}
