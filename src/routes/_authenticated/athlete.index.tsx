import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/athlete/")({
  beforeLoad: () => {
    throw redirect({ to: "/athlete/plans" });
  },
});
