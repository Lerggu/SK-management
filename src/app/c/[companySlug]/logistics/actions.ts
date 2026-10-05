"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { bookingService } from "@/modules/logistics/booking.service";
import { deliveryService, logisticsLocationService, logisticsRequestService } from "@/modules/logistics/logistics.service";
import type { BookingInput, DeliveryInput, LocationInput, RequestInput, RescheduleInput } from "@/modules/logistics/schemas";
import { formInput, formObject, runAction, type ActionState } from "@/app/_lib/action";
import { requireCompanyContext } from "@/app/_lib/context";

const root = (slug: string) => `/c/${slug}/logistics`;
function refresh(slug: string) {
  revalidatePath(root(slug), "layout");
  revalidatePath(`/c/${slug}/takt`, "layout");
}
const done = (r: ActionState): ActionState => (r.ok ? { ok: true, message: r.message } : r);

export async function createLocationAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => logisticsLocationService.create(ctx, formInput<LocationInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function archiveLocationAction(slug: string, locationId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => logisticsLocationService.archive(ctx, locationId).then(() => undefined));
  refresh(slug);
  return r;
}

export async function createRequestAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  let id: string | null = null;
  const r = await runAction(formData, async () => {
    id = (await logisticsRequestService.create(ctx, formInput<RequestInput>(formData))).id;
  });
  refresh(slug);
  if (r.ok && id) redirect(`${root(slug)}/requests/${id}`);
  return r;
}

export async function transitionRequestAction(slug: string, requestId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => logisticsRequestService.transition(ctx, requestId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function createDeliveryAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => deliveryService.create(ctx, formInput<DeliveryInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function rescheduleDeliveryAction(slug: string, deliveryId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => deliveryService.reschedule(ctx, deliveryId, formInput<RescheduleInput>(formData)).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function advanceDeliveryAction(slug: string, deliveryId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => deliveryService.advance(ctx, deliveryId, { to: String(formData.get("to") ?? "") }).then(() => undefined));
  refresh(slug);
  return r;
}

export async function createBookingAction(slug: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const input = formObject(formData);
  const r = await runAction(formData, () => bookingService.create(ctx, { ...input, resources: formData.getAll("resources").map(String) } as unknown as BookingInput).then(() => undefined));
  refresh(slug);
  return done(r);
}

export async function decideBookingAction(slug: string, bookingId: string, _: ActionState | null, formData: FormData): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(formData, () => bookingService.decide(ctx, bookingId, formInput(formData)).then(() => undefined));
  refresh(slug);
  return r;
}

export async function cancelBookingAction(slug: string, bookingId: string): Promise<ActionState> {
  const ctx = await requireCompanyContext(slug);
  const r = await runAction(null, () => bookingService.cancel(ctx, bookingId));
  refresh(slug);
  return r;
}
