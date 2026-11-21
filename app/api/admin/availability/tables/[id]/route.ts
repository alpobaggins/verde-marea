import { mutateAvailability, type Context } from "../../mutation";

export async function PATCH(request: Request, { params }: Context) {
  return mutateAvailability(request, { action: "table", id: (await params).id });
}
