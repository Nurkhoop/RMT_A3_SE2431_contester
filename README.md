# CodeLab Experiment — classroom programming contest

The project uses a static HTML/CSS/JavaScript frontend and a Node.js backend. Python is only used inside Docker to run participant submissions; Python and pip are not needed on the host computer.

## Features
- Five programming exercises covering sorting, prefix sums, graphs, weighted scheduling, and network degree feasibility.
- Two interface variants (gamified and traditional) with the same tasks, test inputs, and grading.
- Anonymous participant IDs, balanced random group assignment, the supplied 17-item pre-survey, 25-minute contest, the supplied 19-item post-survey, attempt tracking, and event logs.
- Researcher dashboard at `/admin` with CSV exports.
- Participant code is evaluated in isolated Docker containers, never by the web server process.
- Existing experiment records in `experiment.sqlite3` are kept in the same SQLite format.

## Quick start on macOS

1. Install Node.js 22.13 or newer and Docker Desktop.
2. In Terminal, open the project folder:

   ```zsh
   cd ~/Desktop/codelab_experiment
   ```

3. Pull the Python image used by the isolated code runner:

   ```zsh
   docker pull python:3.12-alpine
   ```

4. Set the server settings. Replace both example values with your own strong values:

   ```zsh
   export SECRET_KEY='replace-with-a-long-random-secret'
   export ADMIN_PASSWORD='replace-with-a-strong-password'
   export ENABLE_DOCKER_JUDGE=1
   ```

5. Start the app:

   ```zsh
   npm start
   ```

6. Open `http://127.0.0.1:5000` in your browser. The researcher dashboard is at `http://127.0.0.1:5000/admin`.

Keep the Terminal window open while using the site. Press **Control+C** there to stop the server. If you only need to preview the site without running code submissions, Docker and `ENABLE_DOCKER_JUDGE` are optional; solution judging will remain disabled.

## Quick static demo deployment on Netlify

The `public/` folder can be deployed to Netlify as a static preview:

1. Open [Netlify Drop](https://app.netlify.com/drop) and sign in.
2. Drag the project's `public/` folder onto the drop area (the folder contains `index.html`, `app.js`, and `style.css`).
3. When the upload finishes, share the generated `https://....netlify.app` link.

Alternatively, connect the project repository in Netlify, set **Publish directory** to `public`, and leave the build command blank.

The static preview has all five task screens, the supplied pre/post questionnaires, stage navigation, browser-local answer storage, and demo CSV downloads. It has **no backend**: it does not create shared records, perform real researcher authentication, persist data across devices, or run/judge Python submissions. Data and demo exports are only available in the same browser that entered them. Use the Node.js server and Docker setup above to run the real experiment and collect shared research data.

### Using it on a classroom LAN

The server listens only on your computer by default. To allow classroom devices to connect, start it with `HOST=0.0.0.0` and open port 5000 in the local firewall. Share your computer's LAN address, for example `http://192.168.1.20:5000`. Do not expose this prototype directly to the public internet.

## Important limitations before using with real students
- **Prototype for a trusted classroom, not a production internet-facing service.** Docker isolation is defense in depth, not a complete security boundary for hostile code. Do not expose this app directly to the internet.
- Node.js uses its built-in SQLite module; a Node experimental-feature warning may appear in the Terminal.
- The grader's test suites are small illustrative suites (4–8 tests per task). Add adversarial, randomized, and large performance tests for rigorous grading; never expose private tests to participants.
- The source document's fifth problem assumes an undirected **multigraph without self-loops**; the task statement makes that assumption explicit. For task 4, intervals may touch at endpoints.
- The pre/post survey items are shown as written in the supplied questionnaire documents. The post-survey text describes a four-week practice period, while this app currently presents it immediately after the contest; confirm the study schedule before deployment.
- Timers start on individual registration or phase transition, not on a synchronized researcher-controlled start.
- There is no CSRF protection, request throttling, or robust session management. Use only in a small trusted lab.
- Participant code is not stored in the database; only SHA-256 hashes, length, verdicts, and timestamps are kept. Code drafts are saved in browser localStorage; avoid shared browser profiles.
- Engagement is approximated by task openings, editor focus, submissions, and self-report; it is not directly measured by time-on-task.
- The 25-minute stage may be challenging for all five tasks. Pilot and calibrate timing, scoring, and feasibility.
- **Do not share the supplied solutions with participants.**

## Exported data

CSV exports are available for `pre_survey`, `post_survey`, `participants`, `attempts`, `quizzes`, `surveys`, and `events`. The pre/post survey exports contain one row per participant, question-text column headers, and every response; multi-select answers are separated by semicolons. `attempts.elapsed` is seconds since the contest stage started, not time spent on a specific task. Use event timestamps to derive approximate task intervals.
