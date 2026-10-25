# Telemetry (iOS companion)

TelemetryDeck app `F1064ED9-9413-4478-8753-20DC53104F78`, shared with the desktop
editor, so phone and editor signals land in one dashboard. Every signal goes
through `Celiador/Telemetry.swift`, which:

- drops everything when **Account → Share anonymous usage data** is off;
- sends in **test mode** from Dev and Staging builds (bundle id `.dev` / `.staging`);
- sends only the event name, the parameters below, and the SDK defaults (app
  version, OS, device model, a salted hash of `identifierForVendor`).

Never sent: prompts, chat or transcript content, code, file paths, repository or
branch names, session/task ids, error messages, email. Every parameter value
comes from a fixed set. Error codes are derived from the error *type* (HTTP
status or a URL-error class), not its message. Cancellations are never errors.

**v2** marks signals added in `feat/telemetry-v2`; unmarked signals are v1 and
their names/parameters are frozen.

## Catalogue

| Signal | Parameters (allowed values) | Where fired | Question it answers |
|---|---|---|---|
| `celiador/signedIn` | `method`: password, magicLink, github | `LoginView` (password, sign-up, GitHub), `CeliadorApp.onOpenURL` (magic link) | Which sign-in methods do people use? |
| `celiador/phoneRun` | `seeded`: true (first message to an editor repo), task (queued task) | `NewRunView.sendFirst`, `NewTaskSheet.create` | How often is work started from the phone, and how? |
| `celiador/phoneCommand` | `command`: instruct, approve, reject, answer, cancel | `SessionTranscript` steering | Which steering commands get used? |
| `celiador/phonePullRequest` | `created`: true, false (compare link) | `ChangesView.openPullRequest` | Do PRs open from the phone, or fall back to a link? |
| `celiador/chatOpened` | `result`: loaded, failed | `ChatTranscriptView` | Is Activity history read, and does it load? |
| `celiador/newRunOpened` | `editorRepos`: 0, 1, 2-5, 6+ | `NewRunView` | When users open New Run, is their editor reporting repos? |
| `celiador/appLaunched` **v2** | `daysSinceInstall`: 0, 1-7, 8-30, 31+; `liveActivities`: on, off | `CeliadorApp.init` (cold launch) | Retention by install age; how many have Live Activities enabled? |
| `celiador/screenViewed` **v2** | `screen`: login, unreachable, queue, agents, explorer, activity, session, changes, commit, pullRequest, newRun, newRunCompose, newTask, watchedRepos, account, codeFile, chatTranscript | `.trackScreen(_:)` on each tab root, pushed view and sheet (fires per appearance) | Which parts of the app are used at all? Which tabs earn their place? |
| `celiador/onboardingStep` **v2** | `step`: signInShown, signedIn, editorPaired, firstSessionMirrored, firstSessionOpened, firstPhoneCommand; `daysSinceInstall` | `Telemetry.onboarding(_:)` — once per install per step. signInShown: `LoginView`; signedIn: `AppModel.didSignIn` (incl. restored session); editorPaired: first editor-run session in the list, or New Run / New Task finding editor repos; firstSessionMirrored: first editor-originated session in the list; firstSessionOpened: `SessionView`; firstPhoneCommand: any steering command | Where does the sign-in → pair → mirror → steer funnel leak? |
| `celiador/onboardingCompleted` **v2** | `daysSinceInstall` | With `firstPhoneCommand` | What share of installs reach "steered an agent from the phone", and how fast? |
| `celiador/signInFailed` **v2** | `method`: password, signUp, magicLink, github; `reason`: httpNNN, offline, timeout, unreachable, tls, network, client, decode, other, callbackInvalid | `LoginView` catches; invalid magic-link / GitHub callback | Why do sign-ins fail (bad credentials vs. network vs. broken callback)? |
| `celiador/signUpPendingConfirmation` **v2** | — | `LoginView.submit` (sign-up needs email confirmation) | How many sign-ups stall at email confirmation? |
| `celiador/magicLinkSent` **v2** | — | `LoginView.sendMagicLink` | Magic-link sends vs. `signedIn{magicLink}` = link completion rate. |
| `celiador/signedOut` **v2** | — | `AccountView` sign-out | How often do people sign out (churn / account switching)? |
| `celiador/accountDeleted` **v2** | — | `AccountView.deleteAccount` | Account deletions. |
| `celiador/permissionPrompt` **v2** | `permission`: notifications; `result`: granted, denied | `PushManager.requestAuthorization`, only when the status was undetermined (i.e. the system prompt was shown) | What's the push opt-in rate? |
| `celiador/notificationOpened` **v2** | `kind`: push, liveActivity, homeWidget, deepLink; `appState` (push only): running, launching | `PushManager` notification tap; `CeliadorApp.onOpenURL` session links (widget / Live Activity URLs carry `?src=`; untagged = deepLink) | Which re-engagement surface actually brings people back? |
| `celiador/liveActivityStarted` **v2** | — | `LiveActivityManager.start` | Are Live Activities being shown? |
| `celiador/liveActivityEnded` **v2** | `reason`: awaiting, done, error, cancelled, idle, removed, signOut | `LiveActivityManager.reconcile` / `endAll` | How do runs end while a Live Activity is up — how often do they stop to need the user? |
| `celiador/sessionOpened` **v2** | `state`: idle, running, awaiting, done, error, cancelled, unknown; `editor`: online, offline, cloud, unknown | `SessionView.onAppear` (per appearance) | Do people open live runs or finished ones? How often is the editor offline when they try to steer? |
| `celiador/approvalResolved` **v2** | `decision`: approve, deny; `tool`: write, shell, fetch, other; `latency`: <10s, 10-60s, 1-5m, 5-60m, 1h+ | `SessionTranscript.resolve` | Approve/deny ratio per tool class; how fast do people respond from the phone? |
| `celiador/questionAnswered` **v2** | `latency`: as above | `SessionTranscript.answer` | Are agent questions answered from the phone, and how quickly? |
| `celiador/cloudRunStarted` **v2** | — | `NewRunView.start` (server-side run) | Is the cloud-run path used at all vs. editor runs (`phoneRun`)? |
| `celiador/changesViewed` **v2** | `mode`: live, transcript, liveUnavailable; `files`: 0, 1, 2-5, 6+ | `ChangesView` after its first load | Is the phone diff review used, and does live git review work? |
| `celiador/changesCommitted` **v2** | — | `ChangesView.commit` | Do people commit from the phone? |
| `celiador/fileReverted` **v2** | — | `ChangesView.revert` | Is per-file discard used? |
| `celiador/pullRequestMerged` **v2** | `merged`: true, false | `QueueView` merge swipe | Is merge-from-the-queue used, and does it succeed? |
| `celiador/pullRequestLinkOpened` **v2** | — | `QueueView` "Ready for review" row tap | Do people review PRs via the queue? |
| `celiador/taskCancelled` **v2** | — | `QueueView` cancel swipe | How often are queued/running tasks abandoned? |
| `celiador/repoWatchToggled` **v2** | `watched`: true, false | `WatchedReposSheet` | Is the GitHub-issue → task feature being set up? |
| `celiador/sessionDeleted` **v2** | — | `SessionsView` delete swipe | Do people curate the Agents list? |
| `celiador/fileSaved` **v2** | — | `CodeFileView.save` | Is editing files from the phone used? |
| `celiador/error` **v2** | `domain`: config, relay, sessions, run, tasks, git, files, push, liveActivity, history, profile, account; `operation`: fixed per call site (see below); `code`: httpNNN, offline, timeout, unreachable, tls, network, client, decode, other, editorTimeout, or an `ActivityAuthorizationError` case name | See below | Which backend/relay paths fail, and how? |

### `celiador/error` call sites

| domain | operation | Where |
|---|---|---|
| config | load | `AppModel.boot` — daemon `/api/config` unreachable (the "Can't reach Celiador" screen) |
| sessions | list | `AppModel.refresh` — first failure of a streak only (polled every 15s) |
| sessions | delete | `SessionsView.delete` |
| relay | eventStream | `SessionTranscript` — first SSE connect failure per open session |
| relay | instruct, approve, reject, answer, cancel | `SessionTranscript` steering POST failed (still silent to the user) |
| run | editorRun | `NewRunView.sendFirst` — POST failed, or `editorTimeout` when no session appeared within 10s (editor not listening) |
| run | cloudRun | `NewRunView.start` |
| tasks | list | `QueueView.load` — first failure of a streak only (polled every 8s) |
| tasks | create, cancel, watch | `NewTaskSheet`, `QueueView`, `WatchedReposSheet` |
| git | status | `ChangesView.loadLive` (409 editor-offline excluded; see `changesViewed` mode) |
| git | commit, revert, pullRequest, merge | `ChangesView`, `QueueView` |
| files | list, read, write | `DirectoryView`, `CodeFileView` (409 offline / 415 binary excluded) |
| push | apnsRegister | `AppDelegate.didFailToRegisterForRemoteNotifications` |
| push | register | `PushManager.didRegister` — daemon token registration |
| liveActivity | start | `LiveActivityManager.start` — code is the `ActivityAuthorizationError` case or `other` |
| liveActivity | registerToken | `LiveActivityManager.observeToken` |
| history | list | `HistoryView.load` |
| profile | load, save | `AccountView` |
| account | delete | `AccountView.deleteAccount` |

## Retention anchor

`celiador.installDate` (UserDefaults) is written on the first launch of a build
containing v2 telemetry. Existing installs therefore report `daysSinceInstall`
from that upgrade, not from their real install date, and will fire any
already-completed onboarding steps once on upgrade. Funnel keys:
`celiador.telemetry.onboarding.<step>`.

## Useful questions to ask the dashboard

- **Pairing funnel**: `onboardingStep` by `step` (unique users) — signInShown → signedIn → editorPaired → firstSessionMirrored → firstSessionOpened → firstPhoneCommand.
- **Is the editor there when needed?** `sessionOpened` grouped by `editor`, plus `error{domain=run, code=editorTimeout}`.
- **Phone approvals**: `approvalResolved` by `decision` × `tool`, and the `latency` distribution.
- **Re-engagement**: `notificationOpened` by `kind`, against `permissionPrompt{result}` and `appLaunched{liveActivities}`.
- **Relay health**: `error` by `domain`/`operation`/`code`.

Note: the `UnhandledError` signal in the dashboard comes from the desktop
editor's appender, not this app.
