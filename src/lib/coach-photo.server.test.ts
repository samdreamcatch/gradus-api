import { describe, expect, it } from "bun:test";
import {
  coachPhotoObjectPath,
  setCoachPhoto,
  signedCoachPhotoUrl,
  signedCoachPhotoUrls,
} from "./coach-photo.server";

const SUPABASE = "https://proj.supabase.co";
const COACH = "6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER = "7b2f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const photoUrl = (folder = COACH, file = "photo-1.jpg") =>
  `${SUPABASE}/storage/v1/object/authenticated/coach-photos/${folder}/${file}`;

describe("coachPhotoObjectPath", () => {
  it("takes only an authenticated coach-photos URL from this project, with a file in a uuid folder", () => {
    expect(coachPhotoObjectPath(photoUrl(), SUPABASE)).toBe(`${COACH}/photo-1.jpg`);
    expect(coachPhotoObjectPath(photoUrl().replace("proj", "evil"), SUPABASE)).toBeNull();
    expect(
      coachPhotoObjectPath(photoUrl().replace("coach-photos", "plan-media"), SUPABASE),
    ).toBeNull();
    expect(
      coachPhotoObjectPath(photoUrl().replace("authenticated", "public"), SUPABASE),
    ).toBeNull();
    expect(coachPhotoObjectPath(photoUrl(COACH, ""), SUPABASE)).toBeNull();
    expect(coachPhotoObjectPath(photoUrl("not-a-uuid"), SUPABASE)).toBeNull();
    expect(coachPhotoObjectPath("not a url", SUPABASE)).toBeNull();
  });
});

function fakeStorage(signed: string[]) {
  return {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number) => {
          signed.push(`${bucket}:${path}:${expiresIn}`);
          return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
        },
      }),
    },
  };
}

describe("signedCoachPhotoUrl", () => {
  it("signs only a photo inside the coach's own folder", async () => {
    process.env.SUPABASE_URL = SUPABASE;
    const signed: string[] = [];
    const admin = fakeStorage(signed);
    expect(await signedCoachPhotoUrl(admin, COACH, photoUrl())).toBe(
      `https://signed.test/${COACH}/photo-1.jpg`,
    );
    expect(await signedCoachPhotoUrl(admin, COACH, photoUrl(OTHER))).toBeNull();
    expect(await signedCoachPhotoUrl(admin, COACH, null)).toBeNull();
    expect(signed).toEqual([`coach-photos:${COACH}/photo-1.jpg:3600`]);
  });
});

function fakeClient(coach: { id: string } | null) {
  const updates: unknown[] = [];
  const rpcs: unknown[] = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: coach, error: null }),
    update: (payload: unknown) => {
      updates.push(payload);
      return { eq: async () => ({ error: null }) };
    },
  };
  const supabase = {
    from: () => chain,
    rpc: async (fn: string, args: unknown) => {
      rpcs.push([fn, args]);
      return { data: {}, error: null };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: supabase as any, updates, rpcs };
}

describe("setCoachPhoto", () => {
  it("saves a photo in the caller's folder, ticks the checklist, and returns a link", async () => {
    process.env.SUPABASE_URL = SUPABASE;
    const { supabase, updates, rpcs } = fakeClient({ id: COACH });
    const res = await setCoachPhoto({ userId: "u", supabase, admin: fakeStorage([]) }, photoUrl());
    expect(updates).toEqual([{ photo_url: photoUrl() }]);
    expect(rpcs).toEqual([["merge_coach_checklist", { _patch: { uploadProfilePhoto: true } }]]);
    expect(res.photoUrl).toBe(`https://signed.test/${COACH}/photo-1.jpg`);
  });

  it("refuses a photo in another coach's folder and writes nothing", async () => {
    process.env.SUPABASE_URL = SUPABASE;
    const { supabase, updates } = fakeClient({ id: COACH });
    await expect(
      setCoachPhoto({ userId: "u", supabase, admin: fakeStorage([]) }, photoUrl(OTHER)),
    ).rejects.toMatchObject({ status: 422 });
    expect(updates).toEqual([]);
  });

  it("removes the photo with null, without touching the checklist", async () => {
    const { supabase, updates, rpcs } = fakeClient({ id: COACH });
    const res = await setCoachPhoto({ userId: "u", supabase, admin: fakeStorage([]) }, null);
    expect(updates).toEqual([{ photo_url: null }]);
    expect(rpcs).toEqual([]);
    expect(res.photoUrl).toBeNull();
  });

  it("is 404 for a caller with no coach profile", async () => {
    const { supabase } = fakeClient(null);
    await expect(
      setCoachPhoto({ userId: "u", supabase, admin: fakeStorage([]) }, null),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("signedCoachPhotoUrls", () => {
  it("signs a page of coaches' photos in one call, skipping none and foreign folders", async () => {
    process.env.SUPABASE_URL = SUPABASE;
    const calls: string[][] = [];
    const admin = {
      storage: {
        from: () => ({
          createSignedUrls: async (paths: string[]) => {
            calls.push(paths);
            return {
              data: paths.map((path) => ({ path, signedUrl: `https://signed.test/${path}` })),
              error: null,
            };
          },
        }),
      },
    };
    const links = await signedCoachPhotoUrls(admin, [
      { id: COACH, photoUrl: photoUrl() },
      { id: COACH, photoUrl: photoUrl() },
      { id: OTHER, photoUrl: photoUrl(COACH) },
      { id: "c-none", photoUrl: null },
    ]);
    expect(calls).toEqual([[`${COACH}/photo-1.jpg`]]);
    expect([...links]).toEqual([[COACH, `https://signed.test/${COACH}/photo-1.jpg`]]);
  });
});
