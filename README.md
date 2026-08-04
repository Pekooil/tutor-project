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

After building SaturnPath, it came to my mind that I can build a new tool that not only applies to SAT materials only, but literally any subjects as a whole.
Therefore, I built Calyxa, which also runs on an adaptive learning engine that changes response based on the student's performance. However, the most significant improvement from SaturnPath is that it's now an all-round homework helper and live tutor.
It keeps track of the student's progress, time, and provide instant tutor support with socratic tutoring, on-screen annotations, live voice conversations, and adapts to the student's responses.

## Getting Started

Follow 1 of these ways to access Calyxa as a free user with 10 free sessions/month.

1. Go to https://calyxa.app
2. Click "add to chrome"
3. Complete the onboarding workflow
4. Sign up with Google or email account
5. Download Calyxa as Chrome Extension from the redirect link
6. Calyxa will sign in automatically on the extension. Try out the live demo and you're ready to use Calyxa!

## Features & Workflow

Students repeat the following step to drill weak areas with College Board's Question Bank.

- Students input their current SAT score, target score, and their weak areas.
- SaturnPath generates a customized plan based on the student's data and assign different practice sessions for every day.
- The student follows the planner and complete practice sessions. Based on their results, SaturnPath would adapt and adjust future workloads and target topics.
- All questions missed are automatically stored in the Error Log. This allows students to review their mistakes without manually logging their mistakes.
- SaturnPath keeps track of questions left in the question bank to make sure it's not exhausted before the student's test date.

## Design Inspiration

Vercel, Linear, Notion, and Superhuman - referenced in the designing process for navigation bar and overall aesthetic.

## AI Usage

### Development Process
SaturnPath is developed with the assistance and acceleration of Claude's Opus 4.8 and Sonnet 4.6 for code generation and debugging.
However, the primary design and workflow decisions were made by human and not by AI.

### In-App "AI" Features
Although SaturnPath contains the "AI Adaptive Replanner" feature, there is no LLM or external AI API called.  
The "AI Adaptive Replanner" runs on pre-written Typescript Algorithms.

## Acknowledgement

Core Platform

- Vercel — hosting, deployment, analytics, and speed insights
- Supabase — authentication and PostgreSQL database

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

## Copyright Compliance
 
SaturnPath does not access, store, reproduce, or display any 
