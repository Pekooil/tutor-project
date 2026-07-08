import type { SessionPlan } from './session-flow';

// The pre-session plan (design handoff state 6a): the check-in's two
// answers become a three-step vertical timeline the student can start or
// reshuffle. The lead line echoes the student's own words ("your words,
// not mine"); the steps come from buildSessionPlan (session-flow.ts,
// client-side by the agreed no-backend approach). Presentational only —
// Overlay.tsx owns the answers, the reshuffle variant counter, and the
// Start handler (which sends the session-start turn through the normal
// pipeline).
export function PlanCard({
  plan,
  disabled,
  onStart,
  onReshuffle,
}: {
  plan: SessionPlan;
  disabled: boolean;
  onStart: () => void;
  onReshuffle: () => void;
}) {
  return (
    <div className="flex flex-col gap-3.5 px-[18px] pb-[18px] pt-4">
      <p className="m-0 text-[14px] leading-[1.6] text-[#46463f]">
        {plan.lead.before}
        {plan.lead.emphasis && <strong className="font-semibold text-foreground">{plan.lead.emphasis}</strong>}
        {plan.lead.after}
      </p>
      <div className="flex flex-col gap-0.5">
        {plan.steps.map((step, index) => (
          <div key={step.title} className="flex items-start gap-3">
            <div className="flex flex-none flex-col items-center gap-0.5">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] border-accent bg-accent-subtle text-[11.5px] font-semibold text-accent-emphasis"
              >
                {index + 1}
              </span>
              {index < plan.steps.length - 1 && <span aria-hidden="true" className="h-4 w-[1.5px] bg-[#d6f5e1]" />}
            </div>
            <div className="pt-0.5">
              <div className="text-[13.5px] font-semibold text-foreground">{step.title}</div>
              <div className="mt-px text-[12.5px] text-muted-foreground">{step.meta}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onStart}
          disabled={disabled}
          className="h-[42px] flex-1 cursor-pointer rounded-full border-0 bg-accent text-[14px] font-semibold text-accent-foreground outline-none hover:bg-[#6ee7a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Start · ~{plan.totalMinutes} min
        </button>
        <button
          type="button"
          onClick={onReshuffle}
          disabled={disabled}
          className="h-[42px] flex-none cursor-pointer rounded-full border border-border bg-background px-4 text-[13px] text-[#46463f] outline-none hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reshuffle
        </button>
      </div>
    </div>
  );
}
