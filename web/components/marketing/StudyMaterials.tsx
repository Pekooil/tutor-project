import { CalyxaMark } from '@calyxa/ui'

// Landing v6 §5, "Every session becomes study material." — replaces the
// section that used to replay the extension working a homework problem
// (Darcy, 2026-07-24: the hero already shows the extension; this section should
// show what the session LEAVES BEHIND). It is a still of the real post-login
// study surfaces: the notes document, with the quiz and a flashcard beside it.
//
// The mock mirrors components/studio/NotesDocument.tsx rather than inventing a
// layout — centered logomark + title, "Brief Overview", "Key Points" with the
// small circle bullets, a section under its stroke glyph, and the amber
// "Your attempt" callout that prints the student's own wrong work verbatim
// (NotebookMistake.studentAttempt) with the "Ask Calyxa about this →" link.
// Labels are the studio's literal strings so the marketing promise and the
// product stay the same thing. The studio itself defaults to dark; this is its
// light theme, which is what the rest of the landing page is on.

const KEY_POINTS = [
  'The pair has to multiply to c and add to b — both jobs, the same two numbers.',
  'When c is positive the two signs match, and the sign of b decides which one.',
  'When c is negative the signs differ, and the larger number takes b’s sign.',
  'Expand it back out before you move on. It costs five seconds and catches every sign slip.',
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
        <div className="flex flex-col gap-3 text-center sm:gap-4">
          <h2
            className="mkt-display m-0 font-bold text-foreground"
            style={{ fontSize: 'clamp(30px, 4.4vw, 62px)', lineHeight: 1.04, letterSpacing: '-0.035em' }}
          >
            Every session becomes study material.
          </h2>
          <p className="m-0 mx-auto max-w-[56ch] text-pretty text-[17px] text-muted-foreground sm:text-[22px]">
            Notes, a quiz, and flashcards — written from the session you just had, and from the step you actually got
            wrong.
          </p>
        </div>

        <div className="mt-9 grid gap-8 sm:mb-14 sm:mt-[58px] sm:grid-cols-2 sm:gap-[60px]">
          <div className="flex flex-col gap-3 sm:gap-3.5">
            <h3
              className="mkt-display m-0 font-bold text-foreground"
              style={{ fontSize: 'clamp(22px, 2.5vw, 34px)', letterSpacing: '-0.02em' }}
            >
              Notes you didn&apos;t write
            </h3>
            <p className="m-0 text-[17px] leading-[1.5] text-muted-foreground sm:text-[21px]">
              A real document for the concept — the overview, the key points, and the step you slipped on, kept in your
              own words.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:gap-3.5">
            <h3
              className="mkt-display m-0 font-bold text-foreground"
              style={{ fontSize: 'clamp(22px, 2.5vw, 34px)', letterSpacing: '-0.02em' }}
            >
              Then practice the miss
            </h3>
            <p className="m-0 text-[17px] leading-[1.5] text-muted-foreground sm:text-[21px]">
              The quiz and the flashcards come from your mistakes, not from a generic worksheet on the same topic.
            </p>
          </div>
        </div>

        <div className="mt-9 grid gap-3.5 rounded-[20px] border border-(--mkt-hairline) bg-background p-3.5 sm:mt-0 sm:grid-cols-[3fr_2fr] sm:gap-[22px] sm:rounded-[26px] sm:p-[22px]">
          <NotesCard />
          <div className="flex flex-col gap-3.5 sm:gap-[22px]">
            <QuizCard />
            <FlashcardCard />
          </div>
        </div>
      </div>
    </section>
  )
}

// The notes document (NotesDocument.tsx, light theme).
function NotesCard() {
  return (
    <div className="rounded-2xl border border-(--mkt-hairline) bg-background px-5 py-7 sm:rounded-[14px] sm:px-11 sm:py-10">
      <div className="flex items-center justify-center gap-2.5">
        <CalyxaMark className="h-6 w-6 sm:h-[30px] sm:w-[30px]" />
        <h3
          className="m-0 text-center font-bold text-foreground"
          style={{ fontSize: 'clamp(24px, 2.6vw, 40px)', lineHeight: 1.2, letterSpacing: '-0.02em' }}
        >
          Factoring quadratics
        </h3>
      </div>

      <h4 className="mb-4 mt-8 text-[19px] font-bold tracking-[-0.01em] text-foreground sm:mt-11 sm:text-2xl">
        Brief Overview
      </h4>
      <p className="m-0 text-[15px] leading-[1.75] text-foreground sm:text-[16.5px]">
        You can factor <span className="mkt-math italic">x² + bx + c</span> when one pair of numbers multiplies to{' '}
        <span className="mkt-math italic">c</span> and adds to <span className="mkt-math italic">b</span>. Where it
        breaks down for you is the signs, not the search.{' '}
        <span className="text-muted-foreground">
          Last revised after your <span className="text-(--color-accent-emphasis) underline">Jul 22 tutoring session</span>{' '}
          (18 min).
        </span>
      </p>

      <h4 className="mb-4 mt-8 text-[19px] font-bold tracking-[-0.01em] text-foreground sm:mt-9 sm:text-2xl">
        Key Points
      </h4>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {KEY_POINTS.map((point) => (
          <li key={point} className="flex gap-3">
            <span className="mt-[11px] h-[5px] w-[5px] flex-none rounded-full bg-(--mkt-faint)" />
            <span className="text-[15px] leading-[1.7] text-foreground sm:text-[16.5px]">{point}</span>
          </li>
        ))}
      </ul>

      <hr className="my-8 border-0 border-t border-(--mkt-hairline) sm:my-9" />

      <h4 className="m-0 flex items-center gap-2.5 text-[21px] font-bold tracking-[-0.015em] text-foreground sm:text-[28px]">
        <PencilGlyph />
        Where you slipped
      </h4>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <h5 className="m-0 text-[17px] font-bold text-foreground sm:text-[19px]">Sign of the pair</h5>
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
          style={{ background: A2.tint, border: `1px solid ${A2.edge}`, color: A2.deep }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: A2.stroke }} />
          Slipped here once
        </span>
      </div>
      <p className="mb-0 mt-3.5 text-[15px] leading-[1.75] text-foreground sm:text-[16.5px]">
        You found the right pair both times — 2 and 3 — and then gave them the wrong signs. The product tells you
        whether the signs match; only then does the sum tell you which way they point.
      </p>

      {/* The "Your attempt" callout: the student's own work, verbatim. */}
      <div
        className="mt-3.5 rounded-[10px] px-4 py-3.5"
        style={{ background: A2.tint, border: `1px solid ${A2.stroke}` }}
      >
        <span
          className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-[0.09em]"
          style={{ color: A2.deep }}
        >
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: A2.stroke }} />
          Your attempt · Jul 22 session
        </span>
        <p className="mkt-math m-0 mt-2.5 text-[15px] italic sm:text-base" style={{ color: A2.deep }}>
          x² − 5x + 6 = (x − 2)(x + 3)
        </p>
        <p className="m-0 mt-2.5 text-[13px] leading-[1.6] sm:text-[13.5px]" style={{ color: A2.deep }}>
          Both numbers have to be negative here — c is positive, so the signs match, and b is negative, so they are both
          negative. Watch the sign of c first, every time.
        </p>
        <span className="mt-3 inline-block text-[13px] font-semibold" style={{ color: A2.deep }}>
          Ask Calyxa about this →
        </span>
      </div>
    </div>
  )
}

// The quiz (QuizScreen.tsx): progress, question chip, serif statement, reveal.
function QuizCard() {
  return (
    <div className="rounded-2xl border border-(--mkt-hairline) bg-background px-5 py-6 sm:rounded-[16px] sm:px-7 sm:py-8">
      <div className="flex items-center gap-3">
        <span className="h-2.5 flex-1 overflow-hidden rounded-[5px] bg-[#efeeea]">
          <span className="block h-full w-1/6 rounded-[5px] bg-(--calyxa-annot-1)" />
        </span>
        <span className="rounded-full border border-(--mkt-hairline) px-2.5 py-1 text-[13px] font-bold text-muted-foreground">
          1 / 6
        </span>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <span className="rounded-xl border border-(--mkt-hairline) px-3.5 py-2 text-[13.5px] font-semibold text-foreground sm:text-[14.5px]">
          Question 1
        </span>
        <span className="rounded-full border border-(--calyxa-sage-border) bg-accent-subtle px-3 py-1.5 text-[12.5px] font-semibold text-accent-emphasis">
          Algebra 1
        </span>
      </div>

      <p className="mkt-math m-0 mt-5 text-[19px] font-medium leading-[1.55] text-foreground sm:text-[23px]">
        Factor x² − 7x + 12.
      </p>

      <p className="m-0 mt-4 text-[13.5px] leading-[1.6] text-muted-foreground">
        Work it out, then reveal the solution and mark whether you had it.
      </p>
      <span className="mt-4 block rounded-xl bg-accent-fill px-4 py-3 text-center text-[15px] font-semibold text-accent-fill-foreground">
        Reveal the solution
      </span>
    </div>
  )
}

// A flashcard front, with the viewer's counter and footer around it
// (FlashcardsScreen.tsx) — the chrome is what lets this card carry the height
// the notes column sets without leaving a hole in the middle of it.
function FlashcardCard() {
  return (
    <div className="flex flex-1 flex-col gap-3.5 rounded-2xl border border-(--mkt-hairline) bg-background px-5 py-6 sm:rounded-[18px] sm:px-7 sm:py-7">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-muted-foreground">‹ Setup</span>
        <span className="text-[13px] font-semibold text-muted-foreground">3 / 12</span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-(--mkt-hairline) bg-background px-5 py-9 text-center shadow-[0_6px_20px_rgb(15_23_42/0.08)] sm:rounded-[18px] sm:px-8">
        <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">Prompt</span>
        <p className="mkt-math m-0 max-w-[30ch] text-[17px] font-semibold leading-[1.45] text-foreground sm:text-[22px]">
          If the product is positive and the sum is negative, the signs are…
        </p>
        <span className="text-[12.5px] text-muted-foreground">Click to flip</span>
      </div>

      <div className="flex gap-2.5">
        <span className="flex-1 rounded-xl border border-(--mkt-hairline) py-3 text-center text-[14px] font-semibold text-muted-foreground">
          ‹ Previous
        </span>
        <span className="flex-1 rounded-xl bg-accent-fill py-3 text-center text-[14px] font-semibold text-accent-fill-foreground">
          Next ›
        </span>
      </div>
    </div>
  )
}

// The 'pencil' SECTION_ICON (components/studio/icons.tsx), at the section
// heading's size.
function PencilGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] flex-none text-(--color-accent-emphasis) sm:h-[22px] sm:w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
