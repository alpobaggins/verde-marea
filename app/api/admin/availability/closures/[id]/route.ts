import { mutateAvailability, type Context } from "../../mutation";

export async function DELETE(request: Request, { params }: Context) {
  return mutateAvailability(request, { action: "reopen", id: (await params).id });
}
