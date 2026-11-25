import {
  decideOrganizerApplication as decideApplication,
  listMyOrganizerApplications,
  listOrganizerApplications,
  submitOrganizerApplication
} from "./organizers.db.js";

export async function applyForOrganizerAccess(input: {
  organizationId: string;
  applicantUserId: string;
  applicationMessage: string;
  websiteUrl?: string;
}) {
  return submitOrganizerApplication(input);
}

export async function getMyOrganizerApplications(userId: string) {
  return listMyOrganizerApplications(userId);
}

export async function getOrganizerApplications() {
  return listOrganizerApplications();
}

export async function reviewOrganizerApplication(input: {
  applicationId: string;
  reviewerUserId: string;
  decision: "APPROVED" | "REJECTED";
  reason: string;
}) {
  return decideApplication(input);
}
