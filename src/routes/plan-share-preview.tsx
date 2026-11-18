import { createFileRoute } from "@tanstack/react-router";
import { PublicPlanShare } from "@/components/share/public-plan-share";
import type { SharedPlanDTO } from "@/lib/plan-share.functions";

export const Route = createFileRoute("/plan-share-preview")({
  component: PlanSharePreview,
});

const samplePlan: SharedPlanDTO = {
  title: "Edge Control Foundations",
  notes: "Steady edges make every jump and spin easier. Short daily drills, on and off the ice, so you feel the curve instead of fighting it.",
  coachFirstName: "Maya",
  coachLastName: "Chen",
  sharedAt: "2026-11-18T00:00:00.000Z",
  authorKind: "coach",
  authorFirstName: "Maya",
  moves: [
    { position: 0, name: "Forward outside edge circles", description: "Practice smooth circles with an even edge.", cue: "Knee soft, shoulders level, eyes along the circle.", why: "Every jump takes off from a clean edge.", targetKind: "reps", targetValue: 20 },
    { position: 1, name: "Backward outside edge glide", description: "Hold a steady outside edge while gliding backward.", cue: "Keep your free hip lifted.", why: "Builds balance and control.", targetKind: "mins", targetValue: 3 },
    { position: 2, name: "Forward inside edge circles", description: "Trace even circles on both feet.", cue: "Stay tall through your core.", why: "Develops reliable edge changes.", targetKind: "reps", targetValue: 16 },
    { position: 3, name: "Two-foot slalom", description: "Shift smoothly from edge to edge.", cue: "Let your knees guide the movement.", why: "Prepares the body for turns.", targetKind: "reps", targetValue: 12 },
    { position: 4, name: "One-foot balance hold", description: "Balance over the skating foot.", cue: "Keep your shoulders quiet.", why: "Improves stability on the ice.", targetKind: "mins", targetValue: 2 },
    { position: 5, name: "Outside edge step sequence", description: "Connect steps with clean outside edges.", cue: "Finish each push before the next.", why: "Makes transitions more confident.", targetKind: "reps", targetValue: 10 },
    { position: 6, name: "Backward crossovers", description: "Build a controlled crossover rhythm.", cue: "Push through the whole blade.", why: "Builds power while keeping your edge.", targetKind: "reps", targetValue: 12 },
    { position: 7, name: "Three-turn entry edges", description: "Set up each turn from a steady edge.", cue: "Look where you want to travel.", why: "Creates a more controlled turn.", targetKind: "reps", targetValue: 8 },
    { position: 8, name: "Landing position balance", description: "Hold a stable landing position.", cue: "Bend softly and check your shoulders.", why: "Connects edge control to jumps.", targetKind: "mins", targetValue: 2 },
    { position: 9, name: "Forward outside edge changes", description: "Change feet without losing the curve.", cue: "Keep your free leg long.", why: "Strengthens edge consistency.", targetKind: "reps", targetValue: 10 },
    { position: 10, name: "Backward inside edge glide", description: "Hold a clean inside edge.", cue: "Keep your weight centered.", why: "Rounds out edge fundamentals.", targetKind: "mins", targetValue: 3 },
    { position: 11, name: "Power pulls", description: "Use controlled pushes to build speed.", cue: "Push from the edge, not the toe.", why: "Adds power without sacrificing control.", targetKind: "reps", targetValue: 10 },
    { position: 12, name: "Edge change pattern", description: "Combine inside and outside edges.", cue: "Make each curve deliberate.", why: "Brings individual skills together.", targetKind: "reps", targetValue: 8 },
    { position: 13, name: "Cool-down edge glides", description: "Finish with relaxed, quiet glides.", cue: "Breathe and release your shoulders.", why: "Reinforces relaxed edge control.", targetKind: "mins", targetValue: 4 },
  ],
};

function PlanSharePreview() {
  return <PublicPlanShare plan={samplePlan} />;
}
