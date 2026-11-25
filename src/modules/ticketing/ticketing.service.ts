import * as db from "./ticketing.db.js";

export async function createTicketType(input: Parameters<typeof db.createTicketType>[0]) {
  return db.createTicketType(input);
}
export async function listTicketTypes(eventId: string, userId: string) {
  return db.listTicketTypes(eventId, userId);
}
export async function listManagedTicketTypes(eventId: string, userId: string) {
  return db.listManagedTicketTypes(eventId, userId);
}
export async function createHold(input: Parameters<typeof db.createHold>[0]) {
  return db.createHold(input);
}
export async function releaseHold(holdId: string, userId: string) {
  return db.releaseHold(holdId, userId);
}
