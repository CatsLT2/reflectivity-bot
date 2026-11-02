# Discord Bot (hot-reload + modmail + failover)

## Layout

```
src/
  index.js            entry point
  config.js           env config
  core/               client, database, leader election (rarely touched)
  handlers/           loader (hot reload), event dispatcher, command/component router, command sync
  commands/           DROP slash commands here (any subfolder)
  events/             DROP event handlers here (many files may handle the same event)
  components/         DROP button / select / modal handlers here
  utils/              shared helpers (also hot-reloaded)
  models/             mongoose models (restart needed when a schema changes)
scripts/autostart.js  boot auto-start installer
```

## 1. Setup

1. Create an app at https://discord.com/developers/applications -> **Bot** tab -> copy the token.
   No privileged intents are needed.
2. Invite it with scopes `bot` + `applications.commands` and permissions:
   Manage Channels, View Channels, Send Messages, Embed Links, Attach Files, Read Message History.
3. Create a free MongoDB Atlas cluster (or any MongoDB) and copy the connection string.
4. ```
   cp .env.example .env     # fill it in
   npm install
   npm start
   ```
5. In your server run `/modmail setup category:<cat> staff_role:<role> log_channel:<chan>`.
   Then DM the bot from another account to test.

## 2. Modmail

A user DMs the bot. By default they first fill in a short form (summary of the issue + extra info), then a private
channel opens for staff showing their answers, their account info and (if linked) their Roblox profile.

| Command | Who | What |
|---|---|---|
| DM the bot | anyone | opens/continues a ticket |
| `/claim` / `/unclaim` (or the **Claim** button) | staff | take a ticket. Others can't reply or close it (Manage Server can override) and **you are pinged for every reply the user sends** |
| `/reply [message] [anonymous] [attachment]` | staff | reply to the user |
| `!r <text>` / `!an <text>` | staff | reply without a slash command (`!an` = anonymous). Attach files to send them too |
| `/edit message` | staff | edit **your** last reply (only while it is the most recent staff reply). Updated in the DM and here |
| `/delete` | staff | delete the last staff reply, from the user's DMs and from the channel |
| `/note text` | staff | internal note (never sent) |
| `/a name [args]` | staff | run an alias (see below) |
| `/waitclose time [reason] [message]` | staff | close after a delay **unless the user replies first** |
| `/cancelwait` | staff | cancel pending waits / auto-closes on this ticket |
| `/close [reason]` (or the **Close thread** button, which asks for a reason) | staff | close, save the transcript, delete the channel |
| `/stats [days]` | staff | open/closed tickets, average first response and average response time |
| `/modmail setup / contact / block / unblock` | Manage Server / staff | configure (category, staff role, log channel, `survey` on/off), open a ticket with someone, block list |
| `/reactions [on/off]` (in your DMs with the bot) | the user | turn the bot's ✅ reaction on your messages off or on. The ticket panel in their DMs has a button to turn it back on |

Also built in:
- **Typing indicator**: when the user is typing, the ticket channel shows "typing..."; when staff are typing, the user sees it in their DMs.
- **Response time**: measured from the user's first unanswered message to the next staff reply (notes and deleted replies don't count). Shown on every transcript and in `/stats`.
- **Roblox**: linked users get a Roblox profile card on their ticket (username, display name, ID, account age, friends, followers, groups). It uses Roblox's public info endpoints, so a field may be missing if Roblox doesn't return it.

### Required for `!r` / `!an`
Turn on **Message Content Intent** for your bot (discord.com/developers/applications -> your app -> Bot tab) and restart.
If you'd rather not, set `MESSAGE_CONTENT=false` in `.env`; everything else keeps working.
Existing ticket channels created before this update may not let the bot delete your `!r` message (it needs Manage Messages there); new tickets are fine.

## 3. Aliases (macros)

An alias is a saved list of actions that runs with one command. `/alias create name:greet` opens a form; write one action per line:

```
reply Hi {user}, thanks for reaching out! We're looking into it.
note Sent the greeting
claim
```

| Action | Does |
|---|---|
| `reply <text>` | message the user (shows your name) |
| `areply <text>` | message the user anonymously ("Staff Team") |
| `note <text>` | internal note |
| `claim` / `unclaim` | claim or release the thread |
| `close [reason]` | close the thread (must be the last action) |

| `wait <time>` | pause, then carry on with the lines below (30s to 30d, e.g. `10m`, `2h`, `1d12h`) |
| `waitclose <time> [reason]` | shortcut for `wait <time>` + `ifnoreply close <reason>` |

Put `ifnoreply` or `ifreply` in front of any action to run it only if the user has not / has replied since the last wait began:

```
reply Are you still there?
wait 12h
ifnoreply reply Last reminder - we'll close this soon.
waitclose 12h No response from user
```

Waits are saved in the database, so they survive restarts and failover. Variables: `{user}` `{mention}` `{staff}` `{server}` `{args}` (the optional text you pass to `/a`). Use `\n` for a line break.
Run one inside a thread with `/a name:greet`. If a step fails (e.g. user has DMs closed) the alias stops there and tells you.
Edit an alias by running `/alias create` with the same name; the form opens pre-filled.

## 4. Attachments

Images and files sent by users are downloaded and re-posted as real attachments, so images show inline in the thread (the first image sits inside the message) and files can be opened. Staff `/reply attachment:` works the same way in the other direction.
Files over the upload limit (10 MB by default, higher on boosted servers) fall back to a link.
Discord's own attachment links expire, so when a thread closes every file is also re-posted to the log channel before the thread channel is deleted.

## 5. Web transcripts

When a ticket closes, the log channel gets a summary with a **View transcript** button that opens
`https://YOUR-DOMAIN/t/<random-token>`: ticket stats (opened, closed, duration, average response time, first response,
who claimed/closed it, close reason), the opening-form answers, the user's Roblox card, and the whole conversation as a chat timeline
(user / staff / anonymous / internal notes / edits / deleted messages, with images shown inline).
It uses the same `PUBLIC_URL` as Roblox linking (see section 7), so it works as soon as that address reaches the bot.
Without `PUBLIC_URL` the log channel gets a plain `.txt` transcript instead.

Treat the link like a password: anyone who has it can read the ticket, so it is only posted in your staff log channel and the page is marked noindex.
Images are saved in the log channel at close and served via fresh links, because Discord's own attachment links expire.

## 6. Rotating statuses

`/status add type:Watching text:{threads} open threads`, `/status remove` (autocompletes), `/status list`,
`/status interval seconds:30` (min 15), `/status next`. Changes apply immediately, no restart.
Placeholders: `{servers}` `{members}` `{threads}` (open modmail threads). With an empty list the bot shows a default status.
Only the active node runs the rotation, so a standby never fights over the status.

## 7. Roblox account linking

An admin posts a panel once with `/roblox panel`. Members click **Link Roblox Account**, sign in to Roblox, confirm on a web page, and the link is saved in your database
(`robloxlinks` collection: Discord ID, Roblox ID, username, display name). Linked Roblox accounts also appear on new modmail threads.
The panel's buttons keep working after restarts and failover. Optional: `/roblox setup verified_role:@Verified` gives members a role when they link and removes it when they unlink.
One Roblox account can only be linked to one Discord account. No Roblox tokens are stored.

**Setup**
1. Go to https://create.roblox.com/dashboard/credentials?activeTab=OAuthTab -> **Create App**.
2. Add the redirect URL `https://YOUR-DOMAIN/roblox/callback` (must match `PUBLIC_URL` exactly) and enable the `openid` and `profile` scopes.
3. Copy the client ID and secret into `.env` (`ROBLOX_CLIENT_ID`, `ROBLOX_CLIENT_SECRET`, `PUBLIC_URL`) and restart once.
4. Make `PUBLIC_URL` reach the bot's web port (`WEB_PORT`, default 3000). The server only listens on `127.0.0.1`, so put a tunnel or reverse proxy in front:
   - **Easiest with failover:** point your domain at the always-on backup server and reverse-proxy to port 3000 (Caddy: `bot.example.com { reverse_proxy 127.0.0.1:3000 }`).
     The callback is stateless (it only uses the shared database), so it works whichever node is the active one.
   - **From your PC:** Cloudflare Tunnel to `http://localhost:3000`. Run the same tunnel on both machines for redundancy.
5. Roblox keeps new OAuth apps in **private mode**. To let your members use it you must publish through Roblox's review
   (Terms of Service and Privacy Policy URLs, plus a demo video of the flow). Until then, test with your own account.

Health check: `https://YOUR-DOMAIN/health` should say `ok`.

## 8. Adding features (no restart)

Save a file in `commands/`, `events/` or `components/` while the bot runs. It is live in about a second.
Slash commands are re-registered with Discord automatically when their definitions change.
If a file has a syntax error the previous working version stays active and the error is logged.

**Command** (`src/commands/fun/hello.js`):
```js
const { SlashCommandBuilder } = require('discord.js');
module.exports = {
  cooldown: 5, // optional, seconds
  data: new SlashCommandBuilder().setName('hello').setDescription('Say hi'),
  async execute(interaction) { await interaction.reply('Hi!'); },
};
```

**Event** (`src/events/fun/welcome.js`):
```js
const { Events } = require('discord.js');
module.exports = {
  name: Events.GuildMemberAdd,
  // runOnAllNodes: true,   // only for things that must run on the standby too
  async execute(member) { /* ... */ },
};
```
(`GuildMemberAdd` needs the GuildMembers intent: add it in `core/client.js` and restart once.)

**Button / modal** (`src/components/x/y.js`): `{ id: 'myfeature:go', execute(interaction) {} }`
matches any customId equal to `id` or starting with `id:`.

Restart IS needed only for: `.env`, `core/`, `handlers/`, `models/`, `package.json`, or new gateway intents.

## 9. Start on boot + auto-restart

```
npm run autostart          # Windows: Administrator terminal. Linux: sudo
npm run autostart:remove
```
Windows creates a Scheduled Task (runs at boot, before login) using `start-bot.cmd`, which restarts the bot if it crashes.
Linux installs a systemd service with `Restart=always`.

## 10. Failover to a second server

Both machines run the **same code, same `.env` (same token + same MONGO_URI)**:

| | your PC | backup server |
|---|---|---|
| `NODE_ROLE` | `primary` | `backup` |
| `NODE_NAME` | `home-pc` | `vps` |

Run `npm run autostart` on both. How it behaves:

- Both nodes stay logged in to Discord (warm standby). Only the one holding a lease in MongoDB handles events and commands, so nothing is ever answered twice.
- PC loses power -> lease expires (about 10s by default, tune with `LEASE_TTL_MS`) -> the backup takes over.
- PC boots again -> primary asks for control back -> backup hands over cleanly within a few seconds.
- Normal shutdown (`Ctrl+C`, `shutdown /s`) releases the lease instantly, so the handover is near-instant.
- `/ping` shows which node is serving you.

Keep the backup's code up to date with `git pull`. Hot reload applies new files automatically
(run `npm install` if `package.json` changed). Both machines need clocks in sync (NTP, default on Windows and Linux).

Honest limit: a sudden power cut cannot be literally zero-gap. For roughly the lease TTL (about 10s by default)
nothing is handling events: slash commands in that window show "application did not respond", and DMs to the bot sent
in that window are not relayed to staff. Graceful shutdowns and the hand-back to your PC avoid this. Lowering
`LEASE_TTL_MS` (practical minimum about 6000) shrinks the window at the cost of more database traffic and a higher
chance of needless flips on a flaky connection.
