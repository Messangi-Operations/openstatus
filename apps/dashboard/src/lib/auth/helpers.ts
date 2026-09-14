import { db, eq } from "@openstatus/db";
import { user, usersToWorkspaces, workspace } from "@openstatus/db/src/schema";
import type { AdapterUser } from "next-auth/adapters";
import * as randomWordSlugs from "random-word-slugs";

// ── Messangi self-host patch ────────────────────────────────────────────────
// OpenStatus self-host has no invite emails and every OIDC login gets its OWN
// workspace. This patch (a) closes registration to one email domain, and (b)
// auto-joins allowed users to a shared workspace as members instead of a solo one.
// Both are env-gated — with neither var set, upstream behavior is unchanged:
//   ALLOWED_EMAIL_DOMAIN=messangi.com   → reject signups from other domains
//   SHARED_WORKSPACE_ID=1               → allowed users join this workspace (member)
export async function createUser(data: AdapterUser) {
  const email = (data.email ?? "").toLowerCase();
  const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "").toLowerCase();
  const sharedWorkspaceId = Number(process.env.SHARED_WORKSPACE_ID ?? "");
  const domainOk = allowedDomain !== "" && email.endsWith(`@${allowedDomain}`);

  // Close registration: only the allowed domain may create an account.
  if (allowedDomain !== "" && !domainOk) {
    throw new Error(`Registration is restricted to @${allowedDomain}`);
  }

  const newUser = await db
    .insert(user)
    .values({
      email: data.email,
      photoUrl: data.image,
      name: data.name,
      firstName: data.firstName,
      lastName: data.lastName,
    })
    .returning()
    .get();

  // Auto-join the shared workspace (member) instead of creating a solo one.
  if (domainOk && Number.isInteger(sharedWorkspaceId) && sharedWorkspaceId > 0) {
    await db
      .insert(usersToWorkspaces)
      .values({
        userId: newUser.id,
        workspaceId: sharedWorkspaceId,
        role: "member",
      })
      .onConflictDoNothing()
      .run();
    return newUser;
  }

  // ── upstream default: create a fresh workspace, user is its owner ──
  let slug: string | undefined = undefined;

  while (!slug) {
    slug = randomWordSlugs.generateSlug(2);
    const slugAlreadyExists = await db
      .select()
      .from(workspace)
      .where(eq(workspace.slug, slug))
      .get();

    if (slugAlreadyExists) {
      console.warn(`slug already exists: '${slug} - recreating new one'`);
      slug = undefined;
    }
  }

  const newWorkspace = await db
    .insert(workspace)
    .values({ slug, name: "" })
    .returning({ id: workspace.id })
    .get();

  await db
    .insert(usersToWorkspaces)
    .values({
      userId: newUser.id,
      workspaceId: newWorkspace.id,
      role: "owner",
    })
    .returning()
    .get();

  return newUser;
}

export async function getUser(id: string) {
  const _user = await db
    .select()
    .from(user)
    .where(eq(user.id, Number(id)))
    .get();

  return _user || null;
}
