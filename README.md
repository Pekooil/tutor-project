# Calyxa

Live, browser-native math tutor that helps students complete homework more efficiently by actually understanding the materials with the right guidance.

## Demonstration

### Home Page

<img width="1920" height="956" alt="Screenshot 2026-06-10 at 1 00 46 AM" src="https://github.com/user-attachments/assets/56413a7e-e6d7-492a-b093-2b1d01792587" />

### Calendar View  

<img width="1920" height="957" alt="Screenshot 2026-06-10 at 1 01 09 AM" src="https://github.com/user-attachments/assets/0af9fca6-9cb5-4d40-82bf-12428211974a" />

### Adaptive Planner  

<img width="1920" height="958" alt="Screenshot 2026-06-10 at 1 02 30 AM" src="https://github.com/user-attachments/assets/5a6a30c3-9be2-49d9-af62-7f0ec1985e13" />

### Error Log  

<img width="1920" height="958" alt="Screenshot 2026-06-10 at 1 05 30 AM" src="https://github.com/user-attachments/assets/2354f7e8-5efc-4f32-8855-5ae6008731b9" />


## Motivation

While studying for the June SAT with only 2 weeks on the schedule, I needed a well-planned workflow that doesn't require any decision everyday I wake up in order to have the most time to study.
I urgently needed a planner/todo list that I can just execute and rinse and repeat.
This is why I made SaturnPath, a free, open-source SAT planner that uses an adaptive planner engine to feed users the best recommended questions based on their performance profile.

After building SaturnPath, it came to my mind that I can build a new tool with a similar adaptive engine that not only applies to SAT materials only, but literally any subjects as a whole.
Therefore, I built Calyxa, which also runs on an adaptive learning engine that changes response based on the student's performance. However, the most significant improvement from SaturnPath is that it's now an all-round homework helper and live tutor.
It keeps track of the student's progress, time, and provide instant tutor support with socratic tutoring, on-screen annotations, live voice conversations, and adapts to the student's responses.

## Getting Started

Follow 1 of these ways to access Calyxa as a free user with 10 free sessions/month.
If you run out, Pro is $10/month for unlimited sessions.

Sign up flow 1 - from Calyxa's official site:
1. Go to https://calyxa.app
2. Click "add to chrome - free"
3. Complete the onboarding workflow
4. Sign up with Google or email account
5. Download Calyxa as Chrome Extension from the redirect link
6. Calyxa will sign in automatically on the extension. Try out the live demo and you're ready to use Calyxa!

Sign up flow 2 - directly from Chrome Web Store:
1. Go to https://chromewebstore.google.com/detail/gedmlagmmllpohdkdpeocpbnmofegnbm?utm_source=item-share-cb
2. Click "add to chrome"
3. Complete the onboarding workflow from the popup page
4. Sign up with Google or email account
5. Calyxa will automatically sign in on the extension. Try out the live demo and you're ready to use Calyxa!

## Features & Workflow

Students repeat the following workflow to complete every homework sessions:
1. Students click "start homework session" on the extension on their homework page
2. Calyxa will scan the student's homework screen and display how many questions they see, what type of question, and student confirms to start the homework session.
3. As the student go through their homework, they click the Calyxa extension after every homework question solved. They click either "check" if they got it right, "question mark" if they got it right but not sure/still shaky, and "cross" if they got it wrong or don't understand at all.
4. If the student select "cross," Calyxa will immediately scan the student's current problem then start tutoring mode. Calyxa teaches socratically so it never gives out the answer directly, and teaches interactively with on-screen annotations, live voice conversation, and adaptive tutor modes including exploring, coaching, and building.
5. After all homework questions are completed, the session ends and gives a quick summary report of the student's performance and improvements. Calyxa then generates notes, practice problems, and flashcards, ready for the student to revisit on Calyxa's dashboard.

## Repo Structure

This is a Turborepo monorepo.

- `/extension` : the WXT Chrome extension (Manifest V3, React overlay in a shadow DOM)
- `/web` : the Next.js marketing site, dashboard, and API routes
- `/packages` : shared code: UI components, curriculum, and the learning model
- `/supabase` : migrations, RLS policies, and seed data
- `/docs` : architecture decision records and sprint plans

Note that cloning this repo won't get you a running copy of Calyxa. The extension
talks to server-side API routes that need Supabase, OpenAI, ElevenLabs, and Stripe
credentials, none of which are in this repository.

## Design Inspiration

- Duolingo: the overall welcoming UI design and minimalistic, simplified workflows
- Khan Academy: the light green color choice that associates with learning and growth
- Turbo AI: the complete workflow of putting notes, flashcards, and practice problems all in one place

## AI Usage

### Development Process
Calyxa is developed with the assistance and acceleration of Claude's Fable 5, Opus 5, Opus 4.8, Sonnet 5, and Sonnet 4.8 for code generation and debugging.
However, the primary design (the extension UI/UX), product goal (pain point solving, ICP), and workflow decisions (the homework session -> study materials closed loop) were made by human and not by AI coding/design tools.

### In-App AI Features

### In-App AI Features

Calyxa makes API calls when:
- The user starts a homework session (but only partially).
  Counting how many questions are on screen and what type they are is done locally in the browser,  with no model calls and network requests.
  Only the topic identification is sent to a model, and it fills in after the question count is already displayed.
- The user selects "cross," which triggers Calyxa's tutor mode with on-screen
  annotations and live voice conversation.
- The user ends/completes a tutoring session, which makes Calyxa update the student's JSON performance profile and generate notes, flashcards, and practice problems.

The AI model/API calls generated by Calyxa run on:
- GPT-4o-mini: general tutor responses, annotations, topic identification, and
  study kit generation
- GPT-4o-mini-transcribe: speech-to-text, for when the student talks during voice mode
- ElevenLabs: text-to-speech, for when Calyxa talks back during voice mode
- Claude Haiku 4.5: kept in the codebase as a backup tutor provider behind an
  environment flag but never used by default

All API keys are server-side only and never shipped inside the extension bundle.
Session audio is streamed for transcription and never stored.

## Acknowledgement

Core Platform

- Chrome Web Store: deployment of extension zip file
- Vercel: hosting, deployment, analytics, and speed insights
- Supabase: authentication and PostgreSQL database

Frameworks & Libraries

- Next.js — React framework (App Router)
- React — UI library
- Tailwind CSS — styling
- Radix UI — headless UI primitives
- Recharts — charting library
- Lucide — icon set
- date-fns — date utility library
- Resend — transactional email reminders
- Geist — font by Vercel
