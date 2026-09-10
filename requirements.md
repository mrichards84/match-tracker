frontend - next.JS, react
backend - .NET 10

no auth
PWA, all storage is on device, no cloud storage / DB needed - prompt for install when accessed
app will mainly be consumed on a mobile device, must be easily navigable on this device

Football (UK, not USA) - keep track of the following during games:
- goals scored for each player
- time on pitch for each player
- time as goalkeeper

Home page
- create team
- select team -> Team page

Create Team
- team name
- enter squad (players) - don't need any player details apart from name (do not prompt for DOB, picture etc.)

Team page
- Edit team name
- Edit squad
  - can edit an existing player (e.g. to correct name), but this should not be used to replace a player as the stats will carry over
  - mark a player as inactive (ie. no longer in squad)
  - add a new player
- Start match -> Match setup page
- View results -> Results list
- View squad stats -> Squad page

Match setup page
- select starting lineup, including specifying goalkeeper
- enter opposition name
- start match -> Match page

Match page
- start timer - display MM:ss so far
- pause timer
- display score
- mark goal scored against player for your team, or for the other team
- substitute player for another one
- bring on additional player(s) - for powerplay rules
- keep track of following for each player
  - playing time
  - goalkeeper time
  - goals scored
- end match -> take to results page

Results list
- list of previous games with date, opposition team name and score
- select individual result for more info -> Result page

Result page
- show match timeline with
  - goals scored
  - substitutions made

Squad page
- for each player
  - number of games played
  - total playing time
  - playing time per match (average)
  - playing time in last match
  - goals scored
