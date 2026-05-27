Meowmoon Bowling v1.1
Eleventh playable iteration

How to run locally
1. Unzip the folder.
2. Open index.html in a modern browser, or serve the folder with a simple local web server.
3. The intro title screen stays visible until the first non-cat tap.
4. Tap anywhere except the Meowmoon mascot to begin and roll the ball.
5. Long-press the Meowmoon mascot for about 3 seconds to pause.
6. Tap anywhere while paused to resume.

Changes from v1.0.3
- Removed the maze-level feature rather than merely disabling it.
- Built v1.1 from the clean regular-game code path, so the game returns to regular bowling levels only.
- Added 14 sports-action special pin animations to the active special-pin pool:
  * Bat hits baseball
  * Basketball dribble
  * Basketball shot into hoop
  * Hockey stick slapshot
  * Curling broom and stone
  * Football throw
  * Soccer goal
  * Tennis serve
  * Golf drive
  * Volleyball spike
  * Baseball glove catch
  * Mini bowling strike
  * Ski jump
  * Gymnastics flip
- Updated the app version and service worker cache version to v1.1.

Continuing design
- Same Meowmoon cat mascot placement, size, and long-press pause behavior copied from Bubble Shooter v0.9.
- Same sky background family, pause graphic, and text-box/status-box family copied from Bubble Shooter v0.9.
- No score, no frames, no losing, no timers, no penalties, no accounts, no ads, and no in-app purchases.
- Randomly generated regular levels with 16 to 24 pins.
- Unlimited balls.
- Tap-to-aim with quiet assist.
- Side-wall bounces still supported.
- One special pin animation is intended to occur on every successful roll.
- No special ball effects are assigned in v1.1.
- Levels are designed to finish in no more than 8 rolls.

Known v1.1 limitations
- Sports actions are canvas-drawn simplified reward animations, not realistic sports physics.
- This package has had a JavaScript syntax check, but it has not yet been device-tested on iPad, Fire tablet, or Galaxy.
