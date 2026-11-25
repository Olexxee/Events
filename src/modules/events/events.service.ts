import * as db from "./events.db.js";

export async function getEventCategories() { return db.listEventCategories(); }
export async function createEventDraft(input: Parameters<typeof db.createDraft>[0]) { return db.createDraft(input); }
export async function updateEventDraft(input: Parameters<typeof db.updateDraft>[0]) { return db.updateDraft(input); }
export async function publishEvent(eventId: string, actorUserId: string) { return db.publishDraft(eventId, actorUserId); }
export async function getManagedEvents(organizationId: string, userId: string) { return db.listManagedEvents(organizationId, userId); }
export async function getManagedEvent(eventId: string, userId: string) { return db.getManagedEvent(eventId, userId); }
export async function discoverEvents(query: Parameters<typeof db.listPublicEvents>[0]) { return db.listPublicEvents(query); }
export async function getPublicEvent(eventId: string) { return db.getPublicEvent(eventId); }
