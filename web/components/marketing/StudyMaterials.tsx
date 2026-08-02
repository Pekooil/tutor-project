import { CalyxaMark } from '@calyxa/ui'

// Landing v6 §5, "Every session becomes study material." — replaces the
// section that used to replay the extension working a homework problem
// (Darcy, 2026-07-24: the hero already shows the extension; this section should
// show what the session LEAVES BEHIND).
//
// 2026-07-25 (Darcy): this used to render the study surfaces at close to full
// size — the whole notes document, with a quiz card and a flashcard beside it.
// It is now a SUMMARY of the pack instead: one card, a header naming the
// session it came from, and three small tiles (notes · quiz · flashcards) that
// each show a couple of real lines and their count. The two column headings
// that sat above it ("Notes you didn't write" / "Then practice the miss") are
// gone with it, and the section heading + subtitle are on the smaller type
// tier the rest of the page moved to.
//
// The tiles still quote the real product rather than inventing copy: the
// studio's own labels (components/studio/NotesDocument.tsx, PanelQuiz.tsx,
// PanelFlashcards.tsx) and the amber "Your attempt" callout that prints the
// student's own wrong work verbatim (NotebookMistake.studentAttempt). The
// studio itself defaults to dark; this is its light theme, which is what the
// rest of the landing page is on.
//
// 2026-07-30 (Darcy: "the font and design", "supposed to be black"): the
// first pass at these tiles used mkt-math (italic Georgia) for every
// equation, which is the marketing page's OWN artboard convention for its
// tutoring demos — not what the studio actually renders. math.tsx's own
// comment is explicit: "NO serif and NO italic. The capsule inherits the
// page's sans font" — matched to the extension's real math treatment
// (Overlay.tsx's renderSay). And the studio's body prose is plain `T.ink`
// (--color-foreground, i.e. text-foreground) throughout — PanelQuiz's
// statement, the revealed "Why" card, and PanelFlashcards' prompt are all
// black, not colour-washed. Every equation below is now MathCapsule's real
// shape (16px-radius pill, sans, font-weight 600, no italic) and every prose
// line is text-foreground unless the real component colours it (the mistake
// callout's amber ink, the "Why:" label's accent green — both pulled straight
// from NotesDocument.tsx / PanelQuiz.tsx, not invented).

// Two of the notes document's four key points — the pack summary shows a
// couple and counts the rest.
const KEY_POINTS = [
  'The pair has to multiply to c and add to b — both jobs, the same two numbers.',
  'When c is positive the two signs match, and the sign of b decides which one.',
]

// The amber misconception triple (--calyxa-annot-2), which is not theme-
// flipped — the studio uses the -deep ink on the -tint fill for exactly this.
const A2 = { stroke: '#b45309', tint: '#fbf3e4', edge: '#f0e0bc', deep: '#8a4106' }

export function StudyMaterials() {
  return (
    <section
      id="study"
      className="border-t border-(--mkt-hairline) bg-[#f7f7f5] px-[22px] py-14 sm:px-11 sm:pb-[110px] sm:pt-[100px]"
    >
      <div className="mx-auto max-w-[1240px]">
        <div className="flex flex-col gap-2 text-center sm:gap-2.5">
          <h2
            className="mkt-display m-0 font-bold text-foreground"
            style={{ fontSize: 'clamp(23px, 2.2vw, 34px)', lineHeight: 1.1, letterSpacing: '-0.025em' }}
          >
            The set writes your study kit.
          </h2>
          <p className="m-0 mx-auto max-w-[56ch] text-pretty text-[14.5px] text-muted-foreground sm:text-[16.5px]">
            Built from the problems you actually got wrong. Notes, a quiz and flashcards, waiting when the test comes.
          </p>
        </div>

        <StudyPack />
      </div>
    </section>
  )
}

// The pack summary: the session it came from, then the three artifacts as
// small tiles rather than full surfaces.
function StudyPack() {
  return (
    <div className="mt-8 rounded-[20px] border border-(--mkt-hairline) bg-background p-3.5 sm:mt-11 sm:rounded-[26px] sm:p-[22px]">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1 pb-3.5 sm:pb-[18px]">
        <CalyxaMark className="h-[18px] w-[18px] flex-none" />
        <span className="text-[15px] font-bold tracking-[-0.015em] text-foreground sm:text-[17px]">
          Factoring quadratics
        </span>
        <span className="text-[13px] text-muted-foreground sm:text-[13.5px]">
          from your <span className="text-(--color-accent-emphasis) underline">Jul 22 set</span> — 8 problems, 38 min
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 sm:gap-3.5">
        <NotesTile />
        <QuizTile />
        <FlashcardsTile />
      </div>
    </div>
  )
}

// A tile's header: what it is, and how much of it there is.
function TileHead({ kind, count }: { kind: string; count: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-(--color-accent-emphasis)">{kind}</span>
      <span className="text-[11.5px] font-semibold text-muted-foreground">{count}</span>
    </div>
  )
}

// The notes document (NotesDocument.tsx, light theme) — its Key Points list,
// cut to two, and the mistake callout that carries the student's own work.
function NotesTile() {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-(--mkt-hairline) bg-background px-4 py-3.5 sm:px-[18px] sm:py-4">
      <TileHead kind="Notes" count="4 key points" />

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {KEY_POINTS.map((point) => (
          <li key={point} className="flex gap-2.5">
            <span className="mt-[8px] h-[4px] w-[4px] flex-none rounded-full bg-(--mkt-faint)" />
            <span className="text-[13px] leading-[1.55] text-foreground sm:text-[13.5px]">{point}</span>
          </li>
        ))}
      </ul>

      {/* The "Your attempt" callout: the student's own work, verbatim. */}
      <div
        className="mt-auto rounded-[10px] px-3 py-2.5"
        style={{ background: A2.tint, border: `1px solid ${A2.stroke}` }}
      >
        <span
          className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.09em]"
          style={{ color: A2.deep }}
        >
          <span className="h-[6px] w-[6px] rounded-full" style={{ background: A2.stroke }} />
          Your attempt · Jul 22 set
        </span>
        {/* MathCapsule's real shape (math.tsx): sans, font-weight 600, no
            italic, 16px-radius pill in the mistake tone — never serif. */}
        <p className="m-0 mt-2">
          <span
            className="inline-block max-w-full rounded-2xl px-2.5 py-0.5 text-[13px] font-semibold leading-relaxed sm:text-[13.5px]"
            style={{ background: A2.tint, color: A2.deep }}
          >
            2x² + 5x − 3 = (2x − 1)(x + 3)
          </span>
        </p>
        <p className="m-0 mt-1.5 text-[11.5px] leading-[1.5]" style={{ color: A2.deep }}>
          The signs are swapped — check which factor takes the minus.
        </p>
        <span className="mt-2 inline-block text-[11.5px] font-semibold" style={{ color: A2.deep }}>
          Ask Calyxa about this →
        </span>
      </div>
    </div>
  )
}

// The quiz (QuizScreen.tsx): progress, the question, the reveal.
function QuizTile() {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-(--mkt-hairline) bg-background px-4 py-3.5 sm:px-[18px] sm:py-4">
      <TileHead kind="Quiz" count="2 / 6" />

      <span className="flex h-1.5 overflow-hidden rounded-[3px] bg-[#efeeea]">
        <span className="block h-full w-2/6 rounded-[3px] bg-(--calyxa-annot-1)" />
      </span>

      {/* PanelQuiz.tsx's statement: plain sans, weight 500, no colour wash. */}
      <p className="m-0 text-[15.5px] font-medium leading-[1.5] text-foreground sm:text-[17px]">
        Factor x² − 7x + 12.
      </p>

      {/* The revealed reason: a neutral raised card, "Why:" in accent green,
          the rest plain black — not a green-tinted box (PanelQuiz.tsx). */}
      <p className="m-0 rounded-[9px] border border-(--mkt-hairline) bg-[#f7f7f5] px-2.5 py-2 text-[12px] leading-[1.55] text-foreground">
        <span className="font-semibold text-accent-emphasis">Why: </span>
        −3 and −4 multiply to 12 and add to −7.
      </p>

      <div className="mt-auto flex flex-col gap-1.5">
        <span className="block rounded-[9px] bg-accent-fill px-3 py-1.5 text-center text-[12.5px] font-semibold text-accent-fill-foreground">
          ✓ I had it
        </span>
        <span className="block rounded-[9px] border border-(--mkt-hairline) bg-background px-3 py-1.5 text-center text-[12.5px] font-semibold text-(--mkt-strip-text)">
          ✕ I missed it
        </span>
      </div>
    </div>
  )
}

// A flashcard front, with the viewer's counter (FlashcardsScreen.tsx).
function FlashcardsTile() {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-(--mkt-hairline) bg-background px-4 py-3.5 sm:px-[18px] sm:py-4">
      <TileHead kind="Flashcards" count="3 / 12" />

      {/* sizeOptions(12) yields exactly these two — the deck never offers a
          rung above its own size (PanelFlashcards.tsx). */}
      <div className="flex gap-1.5">
        <span className="rounded-full border border-(--mkt-hairline) bg-background px-2.5 py-0.5 text-[10.5px] font-semibold text-(--mkt-strip-text)">
          10 Quick
        </span>
        <span className="rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-2.5 py-0.5 text-[10.5px] font-semibold text-accent-emphasis">
          12 Everything
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[12px] border border-(--mkt-hairline) bg-background px-3.5 py-4 text-center shadow-[0_4px_14px_rgb(15_23_42/0.07)]">
        <span className="text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground">Prompt</span>
        {/* PanelFlashcards.tsx's front face: plain sans, weight 600, T.ink. */}
        <p className="m-0 max-w-[26ch] text-[14px] font-semibold leading-[1.4] text-foreground sm:text-[15.5px]">
          Product positive, sum negative — the signs are…
        </p>
        <span className="text-[11.5px] text-muted-foreground">Click to flip</span>
      </div>

      <div className="flex items-center justify-between text-[11.5px] font-semibold text-muted-foreground">
        <span>‹ Previous</span>
        <span>Next ›</span>
      </div>
    </div>
  )
}
