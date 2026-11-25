import {
  addProviderApplicationEvidence,
  changeProviderApprovalStatus,
  listMyProviderApplications,
  listProviderApplications,
  reviewProviderApplication,
  submitProviderApplication
} from "./vybe-provider.db.js";

export async function applyToBecomeVybeProvider(
  input: Parameters<typeof submitProviderApplication>[0]
) {
  return submitProviderApplication(input);
}

export async function getMyVybeProviderApplications(userId: string) {
  return listMyProviderApplications(userId);
}

export async function getVybeProviderApplicationQueue() {
  return listProviderApplications();
}

export async function decideVybeProviderApplication(
  input: Parameters<typeof reviewProviderApplication>[0]
) {
  return reviewProviderApplication(input);
}

export async function submitAdditionalVybeProviderEvidence(
  input: Parameters<typeof addProviderApplicationEvidence>[0]
) {
  return addProviderApplicationEvidence(input);
}

export async function updateVybeProviderApprovalStatus(
  input: Parameters<typeof changeProviderApprovalStatus>[0]
) {
  return changeProviderApprovalStatus(input);
}
