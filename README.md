# FLL SIM

A turn, route and rules lab for robot competitions: FLL first, plus any other competition you add. It's built for SPIKE Prime and Pybricks, runs on GitHub Pages and needs no build step.

- **Turn lab:** runs LQR, PID and the Pybricks gyro through the same 6-turn test (90°, −90°, 180°, 45°, −135°, 90°) on a model of your robot. The model includes friction, motor delay, gyro noise and battery sag. Auto-tune picks gains for your robot, and you can export each controller as real Pybricks code.
- **Soccer tab** (3-wheel kiwi, 4-wheel omni X or +):
  - *Heading lab* compares LQR and PID while the robot drives in random directions and gets bumped. It measures how well each one keeps the robot facing forward, or locked on the goal. Auto-tune and Pybricks export are included.
  - *Joystick → degree* shows the stick angle, the speed after the deadzone, field-relative vs robot-relative angle and the power to each wheel. It works with touch, keys or a gamepad.
  - *Soccer sim* is a match with a ball, a retriever/dribbler, a kicker, auto goal lock when holding the ball, and 2 two-wheel opponent bots (easy/medium/hard).
- **Calibration:** a short script measures your real robot on the hub. You paste the `CAL …` line it prints into the site.
- **Robot builder (3D):** you place SPIKE parts and see mass, centre of mass, yaw inertia, weight on the drive wheels and tipping warnings. You also set drive ports and motor directions here.
- **Field 1:1:** the 2362 × 1143 mm mat with mission markers. You draw a route, it generates Pybricks DriveBase code, and you can simulate the run with realistic turn error.
- **Code:** runs Pybricks Python in the browser (Pyodide plus a Pybricks simulator) and animates it on the field. You can import and export `.py` files.
- **Competitions:** in Admin → Manage competitions you can add any competition. Upload its field map (PNG/JPG) and type the real width × height in mm, or use 📏 *Measure*: tap two points and enter their real distance. Then draw start zones and place scoring spots with their points. Everyone picks the competition from the menu at the top. You can export and import a competition as `.json`.
- **Rules reader:** open the rules PDF to read and search it. A number finder spots field sizes, match times and robot size limits. *Attach to competition* saves the text so every team can open it.
- **AI (optional):** ask questions about the rules and get page references. *Build field setup from rules + map* fills in the field size, match time, robot limit, start zones and scoring spots, which you review before applying. It uses an Anthropic API key that each person enters in AI settings. The key is stored only in that browser and sent only to Anthropic. Don't put a key in `config.js`: anyone could read it on GitHub.
- **Teams and admin:** teams register. With the admin key you can approve, block or remove teams, lock the site, edit the field and missions (including uploading your own mat photo), read every team's programs and export teams as CSV.

## 1. Put it on GitHub Pages

1. Create a new **public** repository on GitHub, for example `fll-sim`.
2. Upload every file in this folder, keeping the same folder structure.
3. Go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, then `main` and `/ (root)`, and save.
4. After about a minute the site is live at `https://YOUR-USERNAME.github.io/fll-sim/`.

## 2. Admin key

Open **Admin** on the site and enter your key. The key is stored only as a SHA-256 hash in `js/config.js`.
To change it, go to Admin → *Change admin key*, make a hash for your new key and paste it into `adminKeyHash` in `js/config.js`.

## 3. Local mode vs cloud mode (important)

GitHub Pages only serves files. It has no server or database. So by default the site runs in **local mode**:
- Accounts, programs and settings live in **each visitor's own browser**.
- The Admin page only shows teams that registered **in the same browser**.
- The lock only applies in that browser. Anyone can read the source on GitHub, so local mode cannot truly keep people out.

For real, all-device team management, turn on **cloud mode** with Supabase (free tier, about 10 minutes):

1. Create a project at supabase.com.
2. In **SQL Editor**, paste `supabase.sql`, replace `admin@example.com` with your email, and run it.
3. In **Authentication → Users → Add user**, create a user with your email and **your admin key as the password**. Tick *Auto confirm*.
4. Optional: in **Authentication → Providers → Email**, turn off *Confirm email* so teams can log in right after registering.
5. In **Project Settings → API**, copy the Project URL and the `anon` public key into `js/config.js` (`supabaseUrl`, `supabaseAnonKey`). Set `adminEmail` to your email.
6. Commit. The site switches to cloud mode on its own.

In cloud mode the database enforces the rules (row-level security):
- Only approved teams can save programs.
- Only you can approve or remove teams, lock the site or edit the field.
- Only you can read every team's programs.

The `anon` key is meant to be public, so it is fine to commit it.

## Notes

- Part masses in the builder are approximate. You can weigh a part and type its real mass in the *Selected part* panel.
- The default FLL field is a simple drawing at true scale. For the real mat, upload a photo or scan in Admin → Manage competitions, then drag the mission markers onto it.
- Images and rules text are saved inside the site settings. Keep map images reasonably small; they are downscaled to 2000 px automatically.
- The Python simulator moves the robot for `DriveBase` commands (`straight`, `turn`, `curve`, `arc`, `drive` + `wait`). Raw `motor.dc()` loops run, but they don't move the simulated robot.
- Not affiliated with FIRST® or the LEGO Group.
